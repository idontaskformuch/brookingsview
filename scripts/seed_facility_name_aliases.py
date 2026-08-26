"""One-time seed: sets facilities.name_aliases for the handful of landmark
venues the Venue & Category Image Identity feature actually needs it for
(see NEEDS-HUMAN-REVIEW.md, "Venue & Category Image Identity" and
site/src/lib/images.ts's module docstring).

WHY ONLY THESE FEW: name_aliases is used for title-PREFIX matching (the
substring before a story title's first colon, after stripping the "{Town}:
" prefix -- see images.ts's extractTitleVenuePrefix()). Only Moreno
Valley's three library branches actually have a scraper-emitted
venue-prefix convention in their titles ("MAIN LIBRARY: ...", "MV MALL:
...", "IRIS PLAZA: ..."); Brookings events carry no venue prefix at all
(confirmed live, 2026-08 query of the 15 most recent Brookings event
titles). Brookings' library/city-hall aliases here instead serve the
SECOND matching branch (a venue_raw match, "Brookings Public Library" per
scripts/backfill_brookings_library_venue.py's own forward-going default).
Every other facility (parks, community centers, ...) has no title-prefix
or venue_raw convention worth seeding and is left with the migration's
default empty array -- it will only ever get an image via the category
tier, never a bespoke per-venue one.

Values are the REAL variant forms observed live in the `stories` table
(2026-08-26 query, not the brief's own possibly-stale examples) --
see the split_part(title, ':', 2) / venue_raw frequency counts referenced
in NEEDS-HUMAN-REVIEW.md.

Usage:
    python -m scripts.seed_facility_name_aliases           # dry run (default)
    python -m scripts.seed_facility_name_aliases --apply   # writes to DB
"""
from __future__ import annotations

import argparse

from db.db import get_conn

# (town_id, facility_slug) -> aliases to seed. Additive (see apply_seed --
# never overwrites an alias a human already added by hand).
SEED: dict[tuple[str, str], list[str]] = {
    ("moreno_valley_ca", "main-library"): [
        "MAIN LIBRARY", "MAIN Library", "MAIN", "Main Library",
    ],
    ("moreno_valley_ca", "mall-branch-library"): [
        "MV MALL", "MV MALL LIBRARY", "MV MALL Library", "MV MALL BRANCH",
        "Mall Branch", "Mall Library", "Moreno Valley Public Library Mall Branch",
    ],
    ("moreno_valley_ca", "iris-plaza-branch-library"): [
        "IRIS PLAZA", "IRIS PLAZA LIBRARY", "Iris Plaza Branch", "Iris Plaza Library",
    ],
    ("moreno_valley_ca", "city-hall"): [
        "City Hall",
    ],
    ("brookings_sd", "public-library"): [
        "Brookings Public Library", "Public Library", "Library",
    ],
    ("brookings_sd", "city-hall"): [
        "City Hall", "Brookings City Hall",
    ],
}


def apply_seed(conn, apply: bool) -> None:
    with conn.cursor() as cur:
        for (town_id, slug), aliases in SEED.items():
            cur.execute(
                "SELECT name_aliases FROM facilities WHERE town_id = %s AND slug = %s",
                (town_id, slug),
            )
            row = cur.fetchone()
            if row is None:
                print(f"  SKIP {town_id}/{slug}: no such facility")
                continue
            existing = set(row[0] or [])
            merged = sorted(existing | set(aliases))
            added = sorted(set(aliases) - existing)
            if not added:
                print(f"  {town_id}/{slug}: already has all {len(aliases)} alias(es), nothing to add")
                continue
            print(f"  {town_id}/{slug}: adding {added}")
            if apply:
                cur.execute(
                    "UPDATE facilities SET name_aliases = %s WHERE town_id = %s AND slug = %s",
                    (merged, town_id, slug),
                )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                     help="Actually write name_aliases. Without this flag, only a "
                          "dry-run report is printed and nothing is written.")
    args = ap.parse_args()

    with get_conn() as conn:
        apply_seed(conn, args.apply)
        if not args.apply:
            print("\nDry run only -- nothing was written. Re-run with --apply to write.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
