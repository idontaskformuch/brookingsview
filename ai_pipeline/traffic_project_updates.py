"""Threads ongoing traffic construction/closures onto City Hall project
pages -- see ai_pipeline/project_threads.py and Claude Code handoff "Story
Threads".

Meeting-sourced project threading already existed (ai_pipeline/
project_updates.py, extended in this same pass to add AI-assisted matching
and a new-candidate review queue). Traffic has no prior system to extend --
project_registry.py's exact case-number matching has only ever covered
meetings, since a traffic incident never carries a planning case number --
so every traffic-sourced match here goes through project_threads.py's
AI-assisted matching. This script is genuinely new orchestration, but reuses
every one of project_threads.py's building blocks exactly as
project_updates.py does for meetings: candidate detection
(is_candidate_traffic_incident), AI matching (ai_match_candidate), synthesis
generation (generate_synthesis), and the new-candidate queue
(queue_new_candidate) -- never an independent, drifting copy of any of them.

Idempotent two ways: an incident already threaded onto a project (a row in
project_updates with this traffic_incident_id -- see
db/migrations/033_project_updates_traffic_unique.sql for the partial unique
index that makes the upsert itself idempotent) or already sitting in
project_new_candidate_queue (pending, approved, OR rejected -- a human's
rejection is a real decision, not re-litigated on the next run) is skipped
before it ever reaches candidate detection.

Usage:
    python -m ai_pipeline.traffic_project_updates --config configs/moreno_valley_ca.json
    python -m ai_pipeline.traffic_project_updates --config configs/moreno_valley_ca.json --dry-run
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

from ai_pipeline.project_threads import (
    ai_match_candidate, generate_synthesis, is_candidate_traffic_incident,
    load_open_projects_for_matching, queue_new_candidate, regenerate_rolling_summary,
)


def find_unthreaded_candidate_incidents(conn, town_id: str) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, title, description, road, incident_type, severity, created_at, last_seen_at
              FROM traffic_incidents ti
             WHERE town_id = %(town_id)s
               AND NOT EXISTS (SELECT 1 FROM project_updates pu WHERE pu.traffic_incident_id = ti.id)
               AND NOT EXISTS (SELECT 1 FROM project_new_candidate_queue q WHERE q.traffic_incident_id = ti.id)
             ORDER BY created_at ASC
            """,
            {"town_id": town_id},
        )
        return [dict(r) for r in cur.fetchall()]


def upsert_traffic_project_update(conn, project_id: int, incident: dict, synthesis: str) -> bool:
    """Returns True if newly inserted. Relies on
    idx_project_updates_traffic_unique (project_id, traffic_incident_id)
    for idempotency -- meeting_id/agenda_counter stay NULL, the columns
    that unique index deliberately ignores."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_updates
                (project_id, traffic_incident_id, source_type, entry_date,
                 agenda_title, source_url, synthesis, outcome)
            VALUES
                (%(project_id)s, %(incident_id)s, 'traffic', %(entry_date)s,
                 %(title)s, NULL, %(synthesis)s, 'pending')
            ON CONFLICT (project_id, traffic_incident_id) WHERE traffic_incident_id IS NOT NULL
            DO UPDATE SET synthesis = EXCLUDED.synthesis
            RETURNING (xmax = 0) AS inserted
            """,
            {
                "project_id": project_id,
                "incident_id": incident["id"],
                "entry_date": incident.get("created_at") or incident.get("last_seen_at"),
                "title": incident["title"],
                "synthesis": synthesis,
            },
        )
        row = cur.fetchone()
        return bool(row and row[0])


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
        incidents = find_unthreaded_candidate_incidents(conn, town_id)
        if not incidents:
            print("  inga otrådade trafikincidenter för den här orten")
            return 0

        new_updates = 0
        new_candidates = 0
        touched_project_ids: set[int] = set()

        for incident in incidents:
            if not is_candidate_traffic_incident(incident):
                continue

            candidate_text = f"{incident['title']}\n{incident.get('description') or ''}".strip()
            if incident.get("road"):
                candidate_text = f"Road: {incident['road']}\n{candidate_text}"

            if args.dry_run:
                print(f"  CANDIDATE (dry-run, no AI call): incident {incident['id']} -- {incident['title']}")
                continue

            open_projects = load_open_projects_for_matching(conn, town_id)
            match = ai_match_candidate(candidate_text, open_projects, cfg)

            if match["match_project_id"] is not None:
                matched = next(p for p in open_projects if p["id"] == match["match_project_id"])
                synthesis, _generated_by, _verified = generate_synthesis(incident["title"], candidate_text, cfg)
                inserted = upsert_traffic_project_update(conn, matched["id"], incident, synthesis)
                touched_project_ids.add(matched["id"])
                if inserted:
                    new_updates += 1
                print(f"  AI-MATCH ({match['confidence']:.2f}): {matched['title']} <- "
                      f"incident {incident['id']} -- {match['reasoning']}")
            else:
                queue_new_candidate(
                    conn, town_id, "traffic", traffic_incident_id=incident["id"],
                    candidate_title=incident["title"], candidate_summary=incident.get("description") or incident["title"],
                    match_reasoning=match["reasoning"], confidence=match["confidence"],
                )
                new_candidates += 1

        if not args.dry_run:
            for project_id in touched_project_ids:
                regenerate_rolling_summary(conn, project_id, cfg)
            conn.commit()
            print(f"\n{new_updates} new project update{'s' if new_updates != 1 else ''}, "
                  f"{len(touched_project_ids)} project{'s' if len(touched_project_ids) != 1 else ''} touched, "
                  f"{new_candidates} new candidate{'s' if new_candidates != 1 else ''} queued for review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
