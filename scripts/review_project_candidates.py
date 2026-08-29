"""Human review queue for candidate NEW Story Threads/projects (see
db/migrations/032_project_threads.sql's project_new_candidate_queue and
ai_pipeline/project_threads.py's own docstring on why auto-creation is
never done -- a wrongly-created project page is publicly visible and
embarrassing in a way a bad digest paragraph isn't).

Mirrors scripts/review_comments.py's exact pattern (no argparse, input()-
driven choice, per-row commit), with one addition this queue specifically
needs: an edit step before approval, since approving here CREATES a new
public project page, not just flips a status on already-written content.

Usage:
    python -m scripts.review_project_candidates                  # all towns
    python -m scripts.review_project_candidates moreno_valley_ca  # one town
"""
from __future__ import annotations

import re
import sys

from db.db import get_conn


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main() -> None:
    town_ids = sys.argv[1:] or None

    with get_conn() as conn:
        with conn.cursor() as cur:
            query = """
                SELECT id, town_id, source_type, meeting_id, traffic_incident_id,
                       candidate_title, candidate_summary, match_reasoning, confidence, created_at
                  FROM project_new_candidate_queue
                 WHERE status = 'pending_review'{town_filter}
                 ORDER BY created_at
            """
            if town_ids:
                cur.execute(query.format(town_filter=" AND town_id = ANY(%s)"), (town_ids,))
            else:
                cur.execute(query.format(town_filter=""))
            rows = cur.fetchall()

        if not rows:
            print("Nothing pending review.")
            return

        for (queue_id, town_id, source_type, meeting_id, traffic_incident_id,
             title, summary, reasoning, confidence, created_at) in rows:
            print("\n" + "=" * 70)
            print(f"#{queue_id}  {town_id}  source={source_type}  confidence={confidence:.2f}  ({created_at})")
            print(f"AI reasoning (why no existing project matched): {reasoning}")
            print("-" * 70)
            print(f"Title:   {title}")
            print(f"Summary: {summary}")
            print("=" * 70)

            choice = input("[a]pprove / [e]dit-and-approve / [r]eject / [s]kip? ").strip().lower()

            if choice in ("a", "e"):
                final_title = title
                final_summary = summary
                final_slug = _slugify(title)
                if choice == "e":
                    edited_title = input(f"Title [{final_title}]: ").strip()
                    if edited_title:
                        final_title = edited_title
                        final_slug = _slugify(final_title)
                    edited_slug = input(f"Slug [{final_slug}]: ").strip()
                    if edited_slug:
                        final_slug = edited_slug
                    edited_summary = input(f"Description [{final_summary}]: ").strip()
                    if edited_summary:
                        final_summary = edited_summary

                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO projects (town_id, slug, title, description)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (town_id, slug) DO NOTHING
                        RETURNING id
                        """,
                        (town_id, final_slug, final_title, final_summary),
                    )
                    new_project = cur.fetchone()
                    if new_project is None:
                        print(f"-> a project with slug '{final_slug}' already exists for {town_id} -- "
                              "not created. Reject this candidate or edit the slug and try again.")
                        continue
                    new_project_id = new_project[0]

                    # Thread the originating item onto the newly-created
                    # project immediately, so the first entry isn't lost.
                    # A plain restatement, not an AI-generated synthesis --
                    # this script never makes an AI call itself (see
                    # project_threads.synthesis_template_fallback for why
                    # that's a safe, intentional default, not a gap).
                    if source_type == "meeting":
                        cur.execute(
                            """
                            INSERT INTO project_updates
                                (project_id, meeting_id, source_type, entry_date, agenda_title, synthesis, outcome)
                            SELECT %s, %s, 'meeting', meeting_date, %s, %s, 'pending'
                              FROM meetings WHERE id = %s
                            """,
                            (new_project_id, meeting_id, title, f"New item: {title}.", meeting_id),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO project_updates
                                (project_id, traffic_incident_id, source_type, entry_date, agenda_title, synthesis, outcome)
                            SELECT %s, %s, 'traffic', COALESCE(created_at, last_seen_at), %s, %s, 'pending'
                              FROM traffic_incidents WHERE id = %s
                            ON CONFLICT (project_id, traffic_incident_id) WHERE traffic_incident_id IS NOT NULL DO NOTHING
                            """,
                            (new_project_id, traffic_incident_id, title, f"New item: {title}.", traffic_incident_id),
                        )
                    cur.execute(
                        "UPDATE project_new_candidate_queue SET status='approved', reviewed_at=now() WHERE id=%s",
                        (queue_id,),
                    )
                conn.commit()
                print(f"-> approved: new project '{final_title}' (slug={final_slug}, id={new_project_id})")

            elif choice == "r":
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE project_new_candidate_queue SET status='rejected', reviewed_at=now() WHERE id=%s",
                        (queue_id,),
                    )
                conn.commit()
                print("-> rejected")
            else:
                print("-> skipped")


if __name__ == "__main__":
    main()
