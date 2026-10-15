"""Phase 7 ("Decisions"), AgendaLink/Broomfield -- mirrors ai_pipeline/
meeting_decisions_legistar.py's shape and discipline, adapted to
AgendaLink's real data shape. Live-verified against 6 real Broomfield
meetings at publishStatus=='minutes' (78 topics, 34 real motions) before
writing any of the logic below -- see this module's own notes for exactly
what that verification found and why each scope decision below follows
from it, not a guess.

Outcome comes ONLY from the minutes' own recorded motion/votingResult --
NEVER from the agenda text or a staff recommendation (same verify-don't-
invent discipline as everywhere else in this codebase). A topic can carry
more than one motion, and array order is NOT chronological order: meeting
11344's "Electric Vehicle Charging" ordinance lists "To Approve"/True
BEFORE "To Amend"/False in its motions[] array, but the two motions'
voteIso timestamps show the amendment was actually voted on ~35 seconds
EARLIER than the approval -- i.e. someone proposed an amendment, it
failed, and the ordinance was then approved as originally written.
final_motion() below sorts by voteIso (not array position) and only
considers motion TYPES that are themselves a final disposition.
'To Approve' is the only dispositive type seen in the live sample (33
occurrences, all True); 'To Amend' is confirmed live to never itself be
one (the one occurrence, False, sits next to an unrelated 'To Approve'
on the SAME topic, per the example above) -- any OTHER motionType.name is
mapped to 'other' rather than guessed, since nothing in the live sample
confirms how e.g. 'To Deny'/'To Continue'/'To Table' should map.

Scope, deliberately narrow (this is what the live verification supports,
not a claim of completeness):
  - Only a Regular/Special/Transition meeting is ever fetched -- Study
    Session/Workshop/Executive Session meetings never reach
    publishStatus 'minutes' (confirmed live: a Study Session's own
    minutes text reads "Council takes no official action during Study
    Sessions therefore minutes are n[ot taken]").
  - Every run re-attempts every meeting within FETCH_WINDOW_DAYS that has
    NO meeting_decisions rows yet at all -- not a fixed "wait N days then
    try once" gate. QA finding #1 (2026-10) caught the original 60-day-
    minimum version skipping a meeting whose minutes were ALREADY
    publishStatus=='minutes' after only 22 days (observed live lag is
    3-6 weeks, but that's an observed median, not a guarantee -- some
    meetings post sooner). A meeting that already has at least one
    meeting_decisions row is excluded from the candidate query itself
    (not just skipped after a wasted fetch) -- once real outcomes exist
    for it, it's done and doesn't need re-checking every run.
  - templateTopic rows are skipped, same discipline as the existing
    agenda parser (scrapers/parsers/agendalink_v1.py).
  - A topic with ZERO motions recorded is skipped ENTIRELY -- not
    ingested even as 'pending'. Live-verified: AgendaLink's own hasVote
    flag is True on EVERY one of 23 real no-motion topics checked
    (proclamations, presentations, a first reading, quarterly reports),
    exactly as often as on topics that DO get a real vote -- it cannot
    be used to distinguish "awaiting a decision" from "no decision is
    ever coming here." Showing nothing is safer than a guessed label.
  - Broomfield bundles its entire consent agenda into ONE bulkTopic
    ("Consent Items") with a single combined motion/vote covering
    several individual items by range ("approve Consent Items 6A-6E") --
    live-verified its own subTopics field is empty even though
    bulkTopic=True, so the individual line items are not separately
    addressable in this endpoint's data. They get ONE shared
    meeting_decisions row (title "Consent Items"), not decomposed into
    one row per line item the way Legistar's own consent_block_
    event_item_id links sub-items to a shared block vote. Flagged, not
    solved -- a real gap if a reader wants to know how one specific
    consent-bundled item fared.

event_item_id is always NULL here -- AgendaLink has no such id.
source_system='agendalink', source_item_id=the topic's own native `id`
field (a Mongo-style hex string; confirmed unique across every topic
checked on a real meeting). ON CONFLICT (source_system, source_item_id)
DO UPDATE, mirroring Legistar's own event_item_id-keyed upsert (see
db/migrations/058_meeting_decisions_source_check.sql for the constraint
this relies on).

Usage:
    python -m ai_pipeline.meeting_decisions_agendalink --config configs/broomfield_co.json
    python -m ai_pipeline.meeting_decisions_agendalink --config configs/broomfield_co.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
import requests

# See module docstring's "Scope" section. 90 days, not 60 -- gives margin
# over the observed 3-6-week (21-42 day) lag to publishStatus=='minutes'
# without the old version's bug of refusing to even CHECK a meeting that
# might already be ready (see find_candidate_meetings()'s own comment).
FETCH_WINDOW_DAYS = 90
FETCH_DELAY_SECONDS = 0.25

# Board names that never reach publishStatus 'minutes' -- confirmed live,
# see module docstring. Substring match against meetings.body.
_NO_VOTE_BOARD_SUBSTRINGS = ("study session", "workshop", "executive session")

# motionType.name (lowercased) -> (outcome_if_votingResult_True, outcome_if_False).
# Only 'to approve' is confirmed live (see module docstring) -- anything
# else falls through to 'other' in outcome_from_motion(), never guessed.
_DISPOSITIVE_MOTION_OUTCOMES: dict[str, tuple[str, str]] = {
    "to approve": ("approved", "denied"),
}


def _headers() -> dict:
    return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}


def is_eligible_board(body: str | None) -> bool:
    lowered = (body or "").lower()
    return not any(s in lowered for s in _NO_VOTE_BOARD_SUBSTRINGS)


def fetch_minutes(base_url: str, native_id: str) -> dict | None:
    r = requests.get(f"{base_url}/api/session/minutes/{native_id}", headers=_headers(), timeout=30)
    if r.status_code != 200:
        return None
    return r.json()


def outcome_from_motion(motion: dict) -> str:
    """See module docstring's dispositive-motion-type discussion."""
    name = ((motion.get("motionType") or {}).get("name") or "").strip().lower()
    passed = motion.get("votingResult")
    if name not in _DISPOSITIVE_MOTION_OUTCOMES:
        return "other"
    if passed is None:
        return "pending"
    passed_outcome, failed_outcome = _DISPOSITIVE_MOTION_OUTCOMES[name]
    return passed_outcome if passed else failed_outcome


def final_motion(motions: list[dict]) -> dict | None:
    """The chronologically LAST motion (by voteIso, NOT array position --
    see module docstring) whose own type is a genuine final disposition.
    A purely procedural motion (e.g. 'To Amend') is never itself
    considered -- it may still be present in `motions`, just not chosen
    here."""
    dispositive = [
        m for m in motions
        if ((m.get("motionType") or {}).get("name") or "").strip().lower() in _DISPOSITIVE_MOTION_OUTCOMES
    ]
    if not dispositive:
        return None
    return max(dispositive, key=lambda m: m.get("voteIso") or "")


def votes_for_motion(motion: dict) -> list[dict] | None:
    votes = motion.get("votes") or []
    if not votes:
        return None
    return [{"person": (v.get("member") or {}).get("name"), "value": v.get("vote")} for v in votes]


def upsert_decision(conn, meeting_id: int, source_url: str | None, topic: dict, motion: dict | None,
                    outcome: str) -> bool:
    """Returns True if newly inserted. source_item_id is the topic's own
    native `id` -- a real, globally unique AgendaLink id, same ON-
    CONFLICT-is-safe reasoning as meeting_decisions_legistar.upsert_
    decision's use of event_item_id."""
    passed_flag = None
    action_name = None
    action_text = None
    votes = None
    if motion is not None:
        action_name = (motion.get("motionType") or {}).get("name")
        action_text = motion.get("wording")
        passed = motion.get("votingResult")
        if passed is not None:
            passed_flag = "Pass" if passed else "Fail"
        votes = votes_for_motion(motion)

    params = {
        "meeting_id": meeting_id,
        "source_system": "agendalink",
        "source_item_id": topic["id"],
        "agenda_number": topic.get("itemNumber"),
        "title": topic.get("title") or "",
        "action_name": action_name,
        "action_text": action_text,
        "passed_flag": passed_flag,
        "outcome": outcome,
        "is_consent_item": bool(topic.get("bulkTopic")),
        "votes": json.dumps(votes) if votes else None,
        "source_url": source_url,
    }
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO meeting_decisions
                (meeting_id, source_system, source_item_id, agenda_number, title,
                 action_name, action_text, passed_flag, outcome, is_consent_item,
                 votes, source_url, updated_at)
            VALUES
                (%(meeting_id)s, %(source_system)s, %(source_item_id)s, %(agenda_number)s, %(title)s,
                 %(action_name)s, %(action_text)s, %(passed_flag)s, %(outcome)s, %(is_consent_item)s,
                 %(votes)s, %(source_url)s, now())
            ON CONFLICT (source_system, source_item_id) DO UPDATE SET
                agenda_number = EXCLUDED.agenda_number,
                title = EXCLUDED.title,
                action_name = EXCLUDED.action_name,
                action_text = EXCLUDED.action_text,
                passed_flag = EXCLUDED.passed_flag,
                outcome = EXCLUDED.outcome,
                is_consent_item = EXCLUDED.is_consent_item,
                votes = EXCLUDED.votes,
                updated_at = now()
            RETURNING (xmax = 0) AS inserted
            """,
            params,
        )
        row = cur.fetchone()
        return bool(row and row[0])


def find_candidate_meetings(conn, town_id: str) -> list[dict]:
    """Every meeting within the last FETCH_WINDOW_DAYS that has already
    happened and has NO meeting_decisions row yet -- the NOT EXISTS keeps
    a meeting whose outcomes already landed out of the candidate set
    entirely (not just skipped after a wasted API call), so a run only
    ever spends a fetch on a meeting that's still actually missing its
    outcomes.

    Real bug caught while building this (live-verified against the
    production DB, 2026-10-15): `interval '%s days'` puts the placeholder
    INSIDE the quoted literal -- psycopg still substitutes it (textually,
    as `$1`), but Postgres then parses the whole thing as a STRING
    containing the literal characters "$1 days", which its interval-input
    parser silently accepts as exactly 1 day, no matter what value was
    actually bound. Confirmed this was ALSO true of the original (pre-fix)
    MIN_DAYS_BEFORE_FETCH=60 gate this function replaces -- it was never
    really a 60-day floor. `%s * interval '1 day'` keeps the placeholder
    OUTSIDE any quotes (a real multiplication, not text substitution), so
    the bound value actually takes effect."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.body, m.agenda_url, m.raw_data->>'id' AS native_id
              FROM meetings m
             WHERE m.town_id = %s
               AND m.raw_data->>'id' IS NOT NULL
               AND m.meeting_date <= now()
               AND m.meeting_date >= now() - (%s * interval '1 day')
               AND NOT EXISTS (
                     SELECT 1 FROM meeting_decisions md WHERE md.meeting_id = m.id
                   )
             ORDER BY m.meeting_date DESC
            """,
            (town_id, FETCH_WINDOW_DAYS),
        )
        rows = cur.fetchall()
    return [
        {"id": r[0], "body": r[1], "agenda_url": r[2], "native_id": r[3]}
        for r in rows if is_eligible_board(r[1])
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    source_cfg = cfg["data_sources"]["city_meetings"]
    base_url = source_cfg.get("base_url", "https://api.agendalink.app").rstrip("/")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        meetings = find_candidate_meetings(conn, town_id)

        new_count = 0
        updated_count = 0
        skipped_not_ready = 0
        skipped_no_motions = 0

        for meeting in meetings:
            data = fetch_minutes(base_url, meeting["native_id"])
            time.sleep(FETCH_DELAY_SECONDS)
            if data is None or data.get("publishStatus") != "minutes":
                skipped_not_ready += 1
                continue

            for topic in data.get("actionTopics") or []:
                if topic.get("templateTopic"):
                    continue
                motions = topic.get("motions") or []
                if not motions:
                    skipped_no_motions += 1
                    continue

                motion = final_motion(motions)
                outcome = outcome_from_motion(motion) if motion else "other"

                if args.dry_run:
                    print(f"  {meeting['body']} {topic.get('itemNumber')} "
                          f"{topic.get('title')!r} -> {outcome}")
                    continue

                inserted = upsert_decision(conn, meeting["id"], meeting["agenda_url"], topic, motion, outcome)
                if inserted:
                    new_count += 1
                else:
                    updated_count += 1

        if not args.dry_run:
            conn.commit()
            print(f"\n{new_count} new, {updated_count} updated, "
                  f"{skipped_not_ready} meetings skipped (not yet publishStatus='minutes'), "
                  f"{skipped_no_motions} topics skipped (no motions recorded)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
