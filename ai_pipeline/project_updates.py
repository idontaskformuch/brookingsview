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

Usage:
    python -m ai_pipeline.project_updates --config configs/moreno_valley_ca.json
    python -m ai_pipeline.project_updates --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline.project_registry import load_projects, match_project, queue_for_review, status_for_outcome
from ai_pipeline.project_threads import (
    ai_match_candidate, generate_synthesis, is_candidate_agenda_item,
    load_open_projects_for_matching, queue_new_candidate, regenerate_rolling_summary,
)

# Later lifecycle stages (permitted, under construction, complete) would
# need a different data source (e.g. cross-referencing the `permits` table
# by address) and are NOT claimed here -- see NEEDS-HUMAN-REVIEW.md for
# this as a real, scoped follow-up rather than a guess.


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
    counter = agenda_item.get("counter") or ""
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
                synthesis    = COALESCE(EXCLUDED.synthesis, project_updates.synthesis)
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
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT outcome FROM project_updates
             WHERE project_id = %s
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

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        projects = load_projects(conn, town_id)
        meetings = find_meetings_with_agenda_items(conn, town_id)
        # A town with zero hand-curated projects still needs its meetings
        # scanned -- that's exactly the case Story Threads' candidate
        # detection exists for (nothing to exact-match against yet, but a
        # rezoning item is still worth queuing for review). Only a town
        # with NEITHER has nothing at all to do here.
        if not projects and not meetings:
            print("  inga projekt och inga möten med agenda_items för den här orten")
            return 0

        new_updates = 0
        new_candidates = 0
        touched_project_ids: set[int] = set()

        for meeting in meetings:
            for item in meeting["raw_data"].get("agenda_items") or []:
                title = item.get("title") or ""
                description = item.get("description") or ""
                project, ambiguous = match_project(projects, title, description)

                if ambiguous:
                    reason = "matches more than one project's case numbers: " + \
                        ", ".join(p["slug"] for p in ambiguous)
                    print(f"  FLAGGAD (ej trådad): {meeting['body']} {item.get('counter')} -- {reason}")
                    if not args.dry_run:
                        queue_for_review(conn, town_id, meeting["id"], item.get("counter"), title, reason)
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
                            print(f"  CANDIDATE (dry-run, no AI call): {meeting['body']} "
                                  f"{item.get('counter')} -- {title}")
                            continue
                        open_projects = load_open_projects_for_matching(conn, town_id)
                        match = ai_match_candidate(candidate_text, open_projects, cfg)
                        if match["match_project_id"] is not None:
                            matched = next(p for p in open_projects if p["id"] == match["match_project_id"])
                            synthesis, _generated_by, _verified = generate_synthesis(title, candidate_text, cfg)
                            inserted = upsert_project_update(conn, matched["id"], meeting, item, synthesis=synthesis)
                            touched_project_ids.add(matched["id"])
                            if inserted:
                                new_updates += 1
                            print(f"  AI-MATCH ({match['confidence']:.2f}): {matched['title']} <- "
                                  f"{meeting['body']} {item.get('counter')} -- {match['reasoning']}")
                        else:
                            queue_new_candidate(
                                conn, town_id, "meeting", meeting_id=meeting["id"],
                                candidate_title=title, candidate_summary=description or title,
                                match_reasoning=match["reasoning"], confidence=match["confidence"],
                            )
                            new_candidates += 1
                    continue

                if args.dry_run:
                    action_item = action_summary_for_counter(meeting, item.get("counter") or "")
                    outcome = (action_item.get("result") if action_item else None) or "pending"
                    print(f"  {project['slug']}: {meeting['body']} {item.get('counter')} "
                          f"({meeting['meeting_date']}) -> {outcome}")
                    continue

                inserted = upsert_project_update(conn, project["id"], meeting, item)
                touched_project_ids.add(project["id"])
                if inserted:
                    new_updates += 1

        if not args.dry_run:
            for project_id in touched_project_ids:
                recompute_project_status(conn, project_id)
                regenerate_rolling_summary(conn, project_id, cfg)
            conn.commit()
            print(f"\n{new_updates} new project update{'s' if new_updates != 1 else ''}, "
                  f"{len(touched_project_ids)} project{'s' if len(touched_project_ids) != 1 else ''} touched, "
                  f"{new_candidates} new candidate{'s' if new_candidates != 1 else ''} queued for review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
