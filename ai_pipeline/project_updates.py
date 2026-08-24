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


def upsert_project_update(conn, project_id: int, meeting: dict, agenda_item: dict) -> bool:
    """Returns True if this was a newly-inserted row (not a re-run touching
    an existing one)."""
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
                (project_id, meeting_id, body, meeting_date, agenda_counter,
                 agenda_title, agenda_url, outcome, vote_yes, vote_no,
                 vote_abstain, vote_absent, source_url)
            VALUES
                (%(project_id)s, %(meeting_id)s, %(body)s, %(meeting_date)s, %(counter)s,
                 %(title)s, %(agenda_url)s, %(outcome)s, %(vote_yes)s, %(vote_no)s,
                 %(vote_abstain)s, %(vote_absent)s, %(source_url)s)
            ON CONFLICT (project_id, meeting_id, agenda_counter) DO UPDATE SET
                outcome      = EXCLUDED.outcome,
                vote_yes     = EXCLUDED.vote_yes,
                vote_no      = EXCLUDED.vote_no,
                vote_abstain = EXCLUDED.vote_abstain,
                vote_absent  = EXCLUDED.vote_absent,
                source_url   = EXCLUDED.source_url
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
        if not projects:
            print("  inga projekt registrerade för den här orten (se data/projects/)")
            return 0

        meetings = find_meetings_with_agenda_items(conn, town_id)
        new_updates = 0
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
            conn.commit()
            print(f"\n{new_updates} new project update{'s' if new_updates != 1 else ''}, "
                  f"{len(touched_project_ids)} project{'s' if len(touched_project_ids) != 1 else ''} touched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
