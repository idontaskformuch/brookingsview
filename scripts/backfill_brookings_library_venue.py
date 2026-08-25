"""One-time backfill: sets venue_raw = "Brookings Public Library" on already-
published Brookings event stories that came from the library's own
calendar (source='library') and have never had a venue at all -- see
NEEDS-HUMAN-REVIEW.md, "Brookings Venue Registry".

WHY THIS IS SAFE, NOT A GUESS: ai_pipeline/publish.py now sets this same
default going FORWARD for newly-published library-sourced events (LibCal's
ICS feed never includes a LOCATION field at all -- confirmed live, 0 of 88
raw library-source event rows have `venue` set). Every event on the
library's OWN calendar genuinely happens at the library building -- a
structural fact about the source, not an inferred or guessed address.
Brookings has exactly one public library, so there's no ambiguity the way
there would be for Moreno Valley's multiple-branch library source (this
script is Brookings-only and does not touch Moreno Valley data).

Only touches rows that are STILL venue_raw IS NULL -- never overwrites a
venue a human or a different source already set. Joins `stories` back to
the raw `events` table via the deterministic `event-{id}` slug (single,
non-series events only -- the ~4 library events grouped into a recurring
series get their venue from the next real publish run instead, since a
series slug isn't a simple id-derived join and re-deriving it here risks
matching the wrong row).

Usage:
    python -m scripts.backfill_brookings_library_venue           # dry run (default)
    python -m scripts.backfill_brookings_library_venue --apply   # writes to DB
"""
from __future__ import annotations

import argparse

from db.db import get_conn

TOWN_ID = "brookings_sd"
DEFAULT_VENUE = "Brookings Public Library"


def find_candidates(conn) -> list[tuple[str, str]]:
    """Returns [(slug, title), ...] for every single (non-series) Brookings
    event story with a NULL venue_raw whose raw source was the library
    calendar."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.slug, s.title
              FROM stories s
              JOIN events e ON e.town_id = s.town_id AND s.slug = 'event-' || e.id::text
             WHERE s.town_id = %s
               AND s.source_type = 'event'
               AND s.venue_raw IS NULL
               AND e.source = 'library'
             ORDER BY s.slug
            """,
            (TOWN_ID,),
        )
        return cur.fetchall()


def apply_backfill(conn, slugs: list[str]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE stories SET venue_raw = %s WHERE town_id = %s AND slug = ANY(%s)",
            (DEFAULT_VENUE, TOWN_ID, slugs),
        )
        return cur.rowcount


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                     help="Actually write venue_raw. Without this flag, only a "
                          "dry-run report is printed and nothing is written.")
    args = ap.parse_args()

    with get_conn() as conn:
        candidates = find_candidates(conn)
        print(f"{len(candidates)} library-sourced Brookings event(s) with no venue_raw:")
        for slug, title in candidates[:10]:
            print(f"  {slug}: {title}")
        if len(candidates) > 10:
            print(f"  ... and {len(candidates) - 10} more")

        if not args.apply:
            print("\nDry run only -- nothing was written. Re-run with --apply to write.")
            return 0

        updated = apply_backfill(conn, [slug for slug, _ in candidates])
        print(f"\nUpdated {updated} row(s) with venue_raw = \"{DEFAULT_VENUE}\".")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
