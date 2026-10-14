"""Threads meeting outcomes onto City Hall project pages -- see
NEEDS-HUMAN-REVIEW.md, "Week 3 -- City Hall Project Pages".

Reads every meeting's agenda_items (see scrapers/parsers/escribe_v1.py) and
matches each item against the hand-curated project registry
(ai_pipeline/project_registry.py) by case number. A matched item becomes a
project_updates row:

  - outcome sourced from that SAME meeting's action_summary_items (matched
    by agenda counter) when present -- a real, confirmed result pulled
    straight from eSCRIBE's Action Summary document.
  - outcome = 'pending' otherwise. This is the common case for Planning
    Commission, which never posts an outcome record on Moreno Valley's
    eSCRIBE portal (verified live -- checked ~20 real meetings spanning
    nearly a year, zero had one), and for any City Council meeting whose
    Action Summary hasn't posted yet. NEVER inferred from the agenda item's
    own staff recommendation text ("That the Commission APPROVE...") --
    that's a recommendation written BEFORE the vote, not a record of what
    happened, and treating it as one is exactly the kind of guess
    verify-don't-invent forbids.

Deliberately a separate script, not folded into publish.py or the escribe
scraper -- same "read source data, thread it separately" reasoning as
ai_pipeline/meeting_followups.py. Idempotent via
ON CONFLICT (project_id, meeting_id, agenda_counter) DO UPDATE, so a later
run that finds a previously-pending item's real outcome (once posted)
updates that row in place instead of duplicating it. A project's `status`
is recomputed from its most recent update's outcome after each run.

Story Threads extension (see ai_pipeline/project_threads.py): an item with
NO exact case-number match is no longer just skipped. If it looks
thread-worthy (is_candidate_agenda_item), it's checked against every
currently-open project with an AI-assisted, cited-confidence match
(ai_match_candidate) -- a confident match appends a synthesis-generated
update to that EXISTING project; anything else is queued into
project_new_candidate_queue for a human to review
(scripts/review_project_candidates.py), never auto-created. The exact-match
path above is completely unchanged by this -- it's additive, not a
replacement.

Incremental processing (owner decision 2026-10-14, see
db/migrations/056_project_updates_checkpoints.sql): a naive rerun of the
above would rescan EVERY historical meeting and re-call the real Anthropic
API for every unmatched candidate-shaped item EVERY run, forever -- the
queue's own dedup only blocks a second QUEUE ROW, not the AI call that
produced it. Two layers fix this:
  - Per-meeting checkpoint: a meeting whose agenda_items are byte-for-byte
    unchanged since the last successful run is skipped ENTIRELY (exact-
    match, ambiguous-flagging and AI-candidate paths alike) -- see
    _agenda_items_hash()/get_checkpoint()/set_checkpoint(). NOT written
    when the AI-call cap below deferred part of a meeting, so it gets a
    fresh look next run. NOTE: this is keyed on the meeting's OWN content,
    not the project registry -- adding a brand new project to data/
    projects/<town>.json does NOT retroactively re-thread already-
    checkpointed PAST meetings against it. That backfill is the same
    manual step seeding a new project already requires (seed_projects.py
    + a manual project_updates.py run), not something a schedule can do
    silently.
  - already_considered(): even within a meeting that DID change (so its
    checkpoint was invalidated), an individual item that already has a
    project_updates row or a project_new_candidate_queue row from a past
    run is skipped without a fresh AI call -- it was already decided once.
  - MAX_AI_CALLS_PER_RUN: a hard ceiling on fresh AI calls in one run
    regardless of the above, so a large backlog (e.g. right after this
    fix ships) can't spend a month's budget in one run -- the remainder
    is deferred to later runs (their meetings aren't checkpointed either).
  - Routine-administrative filter (owner decision 2026-10-14): a known
    category of recurring non-project item (CFD annexations,
    reimbursement resolutions, CIP/budget amendments -- see
    matching_routine_pattern()) is auto-rejected BEFORE the AI call,
    unless it also carries its own independent project signal (a real
    case number, or a phrase like "Tract Map"/"Specific Plan" -- see
    has_project_signal()), in which case it still goes to the AI exactly
    as before. A rejected item is written to project_new_candidate_queue
    with status='auto_rejected' and the matching pattern as the reason
    (not just logged), so it stays visible/auditable AND already_
    considered() correctly skips it on every later run too.

Run-level cadence (owner decision 2026-10-14, revised): the scheduling
workflow calls this script every 6h same as everything else in that job
-- main() itself no-ops immediately (before touching meetings/projects/AI
at all) unless at least MIN_HOURS_BETWEEN_RUNS have passed since the last
SUCCESSFUL (non-dry-run) run for this town, per project_updates_runs.
Deliberately real-elapsed-time based, not an hour-of-day check in the
workflow: a scheduled GitHub Actions run that starts late or gets skipped
outright still self-paces correctly the next time it does run, where an
hour-of-day gate could silently miss a whole day.

Usage:
    python -m ai_pipeline.project_updates --config configs/moreno_valley_ca.json
    python -m ai_pipeline.project_updates --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import api_usage
from ai_pipeline.project_registry import (
    agenda_item_counter, agenda_item_text, extract_case_numbers, load_projects, match_project,
    queue_for_review, status_for_outcome,
)
from ai_pipeline.project_threads import (
    ai_match_candidate, generate_synthesis, is_candidate_agenda_item,
    load_open_projects_for_matching, queue_new_candidate, regenerate_rolling_summary,
)

# Later lifecycle stages (permitted, under construction, complete) would
# need a different data source (e.g. cross-referencing the `permits` table
# by address) and are NOT claimed here -- see NEEDS-HUMAN-REVIEW.md for
# this as a real, scoped follow-up rather than a guess.

# Hard ceiling on fresh AI calls (ai_match_candidate) in a single run --
# see the module docstring's "Incremental processing" section. 10 is
# generous for real steady-state traffic (a handful of new candidate-
# shaped items per day at most across one town) while still bounding
# worst-case cost from a backlog to ~10 x ~$0.003/call =~ $0.03/run.
MAX_AI_CALLS_PER_RUN = 10

# Minimum real elapsed time between successful runs for a given town --
# see the module docstring's "Run-level cadence" section. ~20h, not 24h,
# so a run that drifts an hour or two late on a given day still fires
# that same day instead of sliding forever.
MIN_HOURS_BETWEEN_RUNS = 20


def get_last_success(conn, town_id: str) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_success_at FROM project_updates_runs WHERE town_id = %s",
            (town_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None


def record_run(conn, town_id: str, when: datetime, *, ai_calls: int = 0,
               meetings_processed: int = 0, meetings_skipped: int = 0, cap_hit: bool = False) -> None:
    """Persists this run's own stats (see db/migrations/
    057_project_updates_runs_counters.sql) so a scheduled run is
    confirmable from the DB alone -- no need to read the GitHub Actions
    log for "how many AI calls did it make"."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_updates_runs
                (town_id, last_success_at, ai_calls, meetings_processed, meetings_skipped, cap_hit)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (town_id) DO UPDATE SET
                last_success_at    = EXCLUDED.last_success_at,
                ai_calls           = EXCLUDED.ai_calls,
                meetings_processed = EXCLUDED.meetings_processed,
                meetings_skipped   = EXCLUDED.meetings_skipped,
                cap_hit            = EXCLUDED.cap_hit
            """,
            (town_id, when, ai_calls, meetings_processed, meetings_skipped, cap_hit),
        )


def _agenda_items_hash(items: list[dict]) -> str:
    """Content hash of a meeting's OWN agenda_items -- deliberately NOT
    meetings.content_hash, which is an identity hash (source+event_id+date,
    see db/db.py's content_hash()) that stays the same even when the real
    agenda_items payload is later amended, so it can't detect a genuine
    content change."""
    payload = json.dumps(items, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_checkpoint(conn, meeting_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT agenda_hash FROM project_updates_checkpoints WHERE meeting_id = %s",
            (meeting_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None


def set_checkpoint(conn, meeting_id: int, agenda_hash: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_updates_checkpoints (meeting_id, agenda_hash, processed_at)
            VALUES (%s, %s, now())
            ON CONFLICT (meeting_id) DO UPDATE SET
                agenda_hash = EXCLUDED.agenda_hash,
                processed_at = now()
            """,
            (meeting_id, agenda_hash),
        )


def already_considered(conn, town_id: str, meeting_id: int, counter: str, title: str) -> bool:
    """True if this exact agenda item already has a project_updates row
    (threaded via a past AI match) or a project_new_candidate_queue row
    (queued for human review, any status) from a PRIOR run -- re-calling
    the AI to re-decide it is pure waste, not a chance at a different real
    answer."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM project_updates WHERE meeting_id = %s AND agenda_counter = %s LIMIT 1",
            (meeting_id, counter),
        )
        if cur.fetchone():
            return True
        cur.execute(
            """
            SELECT 1 FROM project_new_candidate_queue
             WHERE town_id = %s AND meeting_id = %s AND candidate_title = %s LIMIT 1
            """,
            (town_id, meeting_id, title),
        )
        return cur.fetchone() is not None


# Routine-administrative filter (owner decision 2026-10-14): a cheap,
# pre-AI gate that drops a known category of recurring non-project item
# (CFD annexations, reimbursement resolutions, CIP/budget amendments)
# BEFORE spending an AI call on it -- live-verified against Moreno
# Valley's own queue that these account for the large majority of
# "candidate-shaped but not actually a project" items. A false positive
# here costs nothing worse than a missed candidate (same fail-safe
# framing as is_candidate_agenda_item's own docstring) -- EXCEPT this
# filter is itself overridden by has_project_signal() below, so an item
# that's unambiguously a real entitlement is never dropped even if it
# also happens to mention e.g. a CFD formation funding its own
# infrastructure.
_ROUTINE_ADMINISTRATIVE_PATTERNS: dict[str, re.Pattern] = {
    "cfd_annexation": re.compile(r"\bANNEX\w*\b.{0,60}\bCFD\b", re.IGNORECASE),
    "community_facilities_district": re.compile(r"\bCOMMUNITY FACILITIES DISTRICT\b", re.IGNORECASE),
    "reimbursement_resolution": re.compile(r"\bREIMBURSEMENT OF\b.{0,80}\bEXPENDITURES\b", re.IGNORECASE),
    "capital_improvement_plan": re.compile(r"\bCAPITAL IMPROVEMENT PLAN\b", re.IGNORECASE),
    "budget_amendment": re.compile(r"\bBUDGET AMENDMENT\b", re.IGNORECASE),
    "adopted_or_proposed_budget": re.compile(r"\b(ADOPTED|PROPOSED)\s+BUDGET\b", re.IGNORECASE),
}

# Phrases that always force full AI-match consideration, bypassing the
# routine-administrative filter above -- a strong, independent signal
# this item IS a real entitlement/development action. Checked ALONGSIDE
# extract_case_numbers() (a real case number is the other such signal).
_PROJECT_SIGNAL_PHRASES = (
    "tract map", "specific plan", "conditional use permit",
    "plot plan", "change of zone", "development agreement",
)


def has_project_signal(title: str, description: str = "") -> bool:
    """True when this item carries its own strong signal of being a real
    project -- an extractable case number, or one of the entitlement-type
    phrases above -- regardless of whether a routine-administrative
    pattern ALSO matches (e.g. a tract map item that incidentally forms a
    CFD to fund its own infrastructure must still reach the AI, not be
    auto-rejected)."""
    haystack = f"{title} {description}"
    if extract_case_numbers(haystack):
        return True
    lowered = haystack.lower()
    return any(phrase in lowered for phrase in _PROJECT_SIGNAL_PHRASES)


def matching_routine_pattern(title: str, description: str = "") -> str | None:
    """The name of the first routine-administrative pattern this item
    matches, or None. Callers must check has_project_signal() FIRST and
    skip this entirely when it's True."""
    haystack = f"{title} {description}"
    for name, pattern in _ROUTINE_ADMINISTRATIVE_PATTERNS.items():
        if pattern.search(haystack):
            return name
    return None


def queue_auto_rejected(conn, town_id: str, meeting_id: int, candidate_title: str,
                        candidate_summary: str, pattern_name: str) -> None:
    """Records a routine-administrative item the filter rejected BEFORE
    any AI call, with status='auto_rejected' and the matching pattern
    name as the reason -- visible/auditable the same way a human-reviewed
    row is (scripts/review_project_candidates.py simply won't show it,
    since that script only lists status='pending_review'), and so
    already_considered() -- which checks project_new_candidate_queue
    regardless of status, by its own docstring -- correctly skips this
    exact item on every later run instead of re-deciding it from scratch."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_new_candidate_queue
                (town_id, source_type, meeting_id, candidate_title, candidate_summary,
                 match_reasoning, confidence, status, reviewed_at)
            VALUES (%s, 'meeting', %s, %s, %s, %s, 0.0, 'auto_rejected', now())
            """,
            (town_id, meeting_id, candidate_title, candidate_summary,
             f"Auto-rejected: matches routine-administrative pattern '{pattern_name}'"),
        )


def find_meetings_with_agenda_items(conn, town_id: str) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, body, meeting_date, agenda_url, raw_data
              FROM meetings
             WHERE town_id = %s AND raw_data ? 'agenda_items'
             ORDER BY meeting_date ASC
            """,
            (town_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def _normalize_counter(counter: str) -> str:
    """The agenda HTML's own counter ("K.2") and the Action Summary PDF's
    counter for the SAME item ("K.2.") differ by a trailing period --
    verified against a real meeting where this silently broke the outcome
    lookup for a real project. Stripped before comparing."""
    return (counter or "").strip().rstrip(".")


def action_summary_for_counter(meeting: dict, counter: str) -> dict | None:
    target = _normalize_counter(counter)
    for item in meeting["raw_data"].get("action_summary_items") or []:
        if _normalize_counter(item.get("counter") or "") == target:
            return item
    return None


def upsert_project_update(conn, project_id: int, meeting: dict, agenda_item: dict, synthesis: str | None = None) -> bool:
    """Returns True if this was a newly-inserted row (not a re-run touching
    an existing one). synthesis is only ever passed by the AI-matched path
    below -- the exact-case-number-match path (this function's original
    caller) has never generated one and doesn't need to; NULL there is
    correct, not a gap."""
    counter = agenda_item_counter(agenda_item)
    action_item = action_summary_for_counter(meeting, counter)

    if action_item is not None:
        outcome = action_item.get("result") or "pending"
        vote = action_item.get("vote") or {}
        source_url = meeting["raw_data"].get("action_summary_url")
    else:
        outcome = "pending"
        vote = {}
        source_url = meeting.get("agenda_url")

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_updates
                (project_id, meeting_id, source_type, entry_date, body, meeting_date, agenda_counter,
                 agenda_title, agenda_url, outcome, vote_yes, vote_no,
                 vote_abstain, vote_absent, source_url, synthesis)
            VALUES
                (%(project_id)s, %(meeting_id)s, 'meeting', %(meeting_date)s, %(body)s, %(meeting_date)s, %(counter)s,
                 %(title)s, %(agenda_url)s, %(outcome)s, %(vote_yes)s, %(vote_no)s,
                 %(vote_abstain)s, %(vote_absent)s, %(source_url)s, %(synthesis)s)
            ON CONFLICT (project_id, meeting_id, agenda_counter) DO UPDATE SET
                outcome      = EXCLUDED.outcome,
                vote_yes     = EXCLUDED.vote_yes,
                vote_no      = EXCLUDED.vote_no,
                vote_abstain = EXCLUDED.vote_abstain,
                vote_absent  = EXCLUDED.vote_absent,
                source_url   = EXCLUDED.source_url,
                synthesis    = COALESCE(EXCLUDED.synthesis, project_updates.synthesis),
                -- meeting_id is part of the conflict key, so EXCLUDED.entry_date
                -- is always this SAME real meeting's own date -- never a
                -- different meeting's date overwriting a correct one. Added
                -- 2026-10-13: entry_date was INSERT-only before, so any row
                -- created before it existed (or before this column was in
                -- the INSERT list) stayed NULL forever on every later rerun.
                entry_date   = EXCLUDED.entry_date
            RETURNING (xmax = 0) AS inserted
            """,
            {
                "project_id": project_id,
                "meeting_id": meeting["id"],
                "body": meeting["body"],
                "meeting_date": meeting["meeting_date"],
                "counter": counter,
                "title": agenda_item["title"],
                "agenda_url": meeting.get("agenda_url"),
                "outcome": outcome,
                "vote_yes": vote.get("yes"),
                "vote_no": vote.get("no"),
                "vote_abstain": vote.get("abstain"),
                "vote_absent": vote.get("absent"),
                "source_url": source_url,
                "synthesis": synthesis,
            },
        )
        row = cur.fetchone()
        return bool(row and row[0])


def recompute_project_status(conn, project_id: int) -> None:
    """The project's status follows the LATEST OFFICIAL outcome -- a row
    still 'pending' with no override isn't one, so it's skipped here even
    if it's chronologically the newest row (e.g. PEN24-0154: a June
    Planning Commission denial with a real outcome_override, followed by a
    September City Council appeal that hasn't been decided yet -- status
    stays 'denied', reflecting the one row that actually has a confirmed
    outcome, not 'under_review' from the still-pending appeal row)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(outcome_override, outcome) FROM project_updates
             WHERE project_id = %s AND (outcome_override IS NOT NULL OR outcome <> 'pending')
             ORDER BY meeting_date DESC LIMIT 1
            """,
            (project_id,),
        )
        row = cur.fetchone()
        outcome = row[0] if row else "pending"
        status = status_for_outcome(outcome)
        cur.execute(
            "UPDATE projects SET status = %s, updated_at = now() WHERE id = %s",
            (status, project_id),
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    # generator is set per-call inside project_threads.py's own three
    # generate functions (project_thread_match/_synthesis/_summary); only
    # town_id/run_id are this script-wide here.
    api_usage.set_default_context(town_id=town_id)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        if not args.dry_run:
            last_success = get_last_success(conn, town_id)
            if last_success is not None:
                elapsed = datetime.now(timezone.utc) - last_success
                if elapsed < timedelta(hours=MIN_HOURS_BETWEEN_RUNS):
                    hours_left = (timedelta(hours=MIN_HOURS_BETWEEN_RUNS) - elapsed).total_seconds() / 3600
                    print(f"  senaste lyckade körning för {town_id} var {elapsed} sedan -- "
                          f"väntar ~{hours_left:.1f}h till, hoppar över denna körning helt "
                          f"(ingen DB-skanning, inga AI-anrop)")
                    return 0

        projects = load_projects(conn, town_id)
        meetings = find_meetings_with_agenda_items(conn, town_id)
        # A town with zero hand-curated projects still needs its meetings
        # scanned -- that's exactly the case Story Threads' candidate
        # detection exists for (nothing to exact-match against yet, but a
        # rezoning item is still worth queuing for review). Only a town
        # with NEITHER has nothing at all to do here.
        if not projects and not meetings:
            print("  inga projekt och inga möten med agenda_items för den här orten")
            if not args.dry_run:
                record_run(conn, town_id, datetime.now(timezone.utc))
                conn.commit()
            return 0

        new_updates = 0
        new_candidates = 0
        skipped_unchanged_meetings = 0
        processed_meetings = 0
        ai_calls_made = 0
        ai_cap_reached_logged = False
        touched_project_ids: set[int] = set()

        for meeting in meetings:
            items = meeting["raw_data"].get("agenda_items") or []
            agenda_hash = _agenda_items_hash(items)
            if get_checkpoint(conn, meeting["id"]) == agenda_hash:
                skipped_unchanged_meetings += 1
                continue
            processed_meetings += 1
            meeting_fully_processed = True

            for item in items:
                title = item.get("title") or ""
                description = agenda_item_text(item)
                project, ambiguous = match_project(projects, title, description)
                counter = agenda_item_counter(item)

                if ambiguous:
                    reason = "matches more than one project's case numbers: " + \
                        ", ".join(p["slug"] for p in ambiguous)
                    print(f"  FLAGGAD (ej trådad): {meeting['body']} {counter} -- {reason}")
                    if not args.dry_run:
                        queue_for_review(conn, town_id, meeting["id"], counter, title, reason)
                    continue

                if project is None:
                    # Story Threads extension: no exact case-number match,
                    # but this might still be a further development of an
                    # ALREADY-tracked project (AI-assisted, cited, confidence-
                    # gated -- see project_threads.ai_match_candidate), or a
                    # brand new story worth queuing for human review. Both
                    # paths are additive to the exact-match system above,
                    # never a replacement for it.
                    if is_candidate_agenda_item(title, description):
                        candidate_text = f"{title}\n{description}".strip()
                        if args.dry_run:
                            if not has_project_signal(title, description):
                                pattern_name = matching_routine_pattern(title, description)
                                if pattern_name is not None:
                                    print(f"  ROUTINE (dry-run, auto-rejected, pattern={pattern_name}, "
                                          f"no AI call): {meeting['body']} {counter} -- {title}")
                                    continue
                            print(f"  CANDIDATE (dry-run, no AI call): {meeting['body']} "
                                  f"{counter} -- {title}")
                            continue
                        if already_considered(conn, town_id, meeting["id"], counter, title):
                            continue
                        if not has_project_signal(title, description):
                            pattern_name = matching_routine_pattern(title, description)
                            if pattern_name is not None:
                                queue_auto_rejected(
                                    conn, town_id, meeting_id=meeting["id"],
                                    candidate_title=title, candidate_summary=description or title,
                                    pattern_name=pattern_name,
                                )
                                print(f"  ROUTINE (auto-rejected, pattern={pattern_name}, no AI call): "
                                      f"{meeting['body']} {counter} -- {title}")
                                continue
                        if ai_calls_made >= MAX_AI_CALLS_PER_RUN:
                            if not ai_cap_reached_logged:
                                print(f"  AI-ANROPSTAK NÅTT ({MAX_AI_CALLS_PER_RUN}/körning) -- "
                                      f"resterande kandidater skjuts upp till nästa körning")
                                ai_cap_reached_logged = True
                            meeting_fully_processed = False
                            continue
                        open_projects = load_open_projects_for_matching(conn, town_id)
                        match = ai_match_candidate(candidate_text, open_projects, cfg)
                        ai_calls_made += 1
                        if match["match_project_id"] is not None:
                            matched = next(p for p in open_projects if p["id"] == match["match_project_id"])
                            synthesis, _generated_by, _verified = generate_synthesis(title, candidate_text, cfg)
                            inserted = upsert_project_update(conn, matched["id"], meeting, item, synthesis=synthesis)
                            touched_project_ids.add(matched["id"])
                            if inserted:
                                new_updates += 1
                            print(f"  AI-MATCH ({match['confidence']:.2f}): {matched['title']} <- "
                                  f"{meeting['body']} {counter} -- {match['reasoning']}")
                        else:
                            queued = queue_new_candidate(
                                conn, town_id, "meeting", meeting_id=meeting["id"],
                                candidate_title=title, candidate_summary=description or title,
                                match_reasoning=match["reasoning"], confidence=match["confidence"],
                            )
                            if queued:
                                new_candidates += 1
                            else:
                                print(f"  DUPLICATE CANDIDATE (same case number already pending review): "
                                      f"{meeting['body']} {counter} -- {title}")
                    continue

                if args.dry_run:
                    action_item = action_summary_for_counter(meeting, counter)
                    outcome = (action_item.get("result") if action_item else None) or "pending"
                    print(f"  {project['slug']}: {meeting['body']} {counter} "
                          f"({meeting['meeting_date']}) -> {outcome}")
                    continue

                inserted = upsert_project_update(conn, project["id"], meeting, item)
                touched_project_ids.add(project["id"])
                if inserted:
                    new_updates += 1

            if not args.dry_run and meeting_fully_processed:
                set_checkpoint(conn, meeting["id"], agenda_hash)

        if not args.dry_run:
            for project_id in touched_project_ids:
                recompute_project_status(conn, project_id)
                regenerate_rolling_summary(conn, project_id, cfg)
            record_run(conn, town_id, datetime.now(timezone.utc), ai_calls=ai_calls_made,
                      meetings_processed=processed_meetings, meetings_skipped=skipped_unchanged_meetings,
                      cap_hit=ai_cap_reached_logged)
            conn.commit()
            print(f"\n{new_updates} new project update{'s' if new_updates != 1 else ''}, "
                  f"{len(touched_project_ids)} project{'s' if len(touched_project_ids) != 1 else ''} touched, "
                  f"{new_candidates} new candidate{'s' if new_candidates != 1 else ''} queued for review, "
                  f"{skipped_unchanged_meetings} unchanged meeting{'s' if skipped_unchanged_meetings != 1 else ''} "
                  f"skipped, {ai_calls_made} AI call{'s' if ai_calls_made != 1 else ''} made")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
