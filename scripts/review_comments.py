"""Manual spot-check queue for held Worker Pulse comments (see
db/migrations/018_worker_pulse_comments.sql and
site/functions/api/comment.ts, which is what actually moderates and writes
these rows). No web admin UI in v1 -- the feature's own spec calls this
"low-volume, spot-checked occasionally, not a daily obligation", so a
script run when the user feels like it is proportionate to that.

Usage:
    python -m scripts.review_comments                  # all towns
    python -m scripts.review_comments moreno_valley_ca  # one town
"""
from __future__ import annotations

import sys

from db.db import get_conn


def main() -> None:
    town_ids = sys.argv[1:] or None

    with get_conn() as conn:
        with conn.cursor() as cur:
            if town_ids:
                cur.execute(
                    """
                    SELECT id, town_id, page_slug, body, moderation_reason, created_at
                      FROM worker_pulse_comments
                     WHERE status = 'pending_review' AND town_id = ANY(%s)
                     ORDER BY created_at
                    """,
                    (town_ids,),
                )
            else:
                cur.execute(
                    """
                    SELECT id, town_id, page_slug, body, moderation_reason, created_at
                      FROM worker_pulse_comments
                     WHERE status = 'pending_review'
                     ORDER BY created_at
                    """
                )
            rows = cur.fetchall()

        if not rows:
            print("Nothing pending review.")
            return

        for comment_id, town_id, page_slug, body, reason, created_at in rows:
            print("\n" + "=" * 70)
            print(f"#{comment_id}  {town_id}  /{page_slug}  ({created_at})")
            print(f"AI reason: {reason}")
            print("-" * 70)
            print(body)
            print("=" * 70)

            choice = input("[p]ublish / [r]eject / [s]kip? ").strip().lower()
            if choice == "p":
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE worker_pulse_comments SET status='published' WHERE id=%s",
                        (comment_id,),
                    )
                conn.commit()
                print("-> published")
            elif choice == "r":
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE worker_pulse_comments SET status='rejected' WHERE id=%s",
                        (comment_id,),
                    )
                conn.commit()
                print("-> rejected")
            else:
                print("-> skipped")


if __name__ == "__main__":
    main()
