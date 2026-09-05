"""One-time seed: sets employers.aliases for the REAL, observed company-name
variants Adzuna's jobs feed uses -- see db/migrations/039_employer_job_stats.sql
for why an exact-match aliases array (not a substring match) is the right
mechanism, and ai_pipeline/workplace_watch_digest.py's count_matching_postings()
for how it's consumed.

WHY SO FEW ENTRIES (Recurring-traffic layer, Fas 4a): verified live
2026-09-05 against the real `jobs` table for both towns with Workplace Watch
enabled -- of the 8 currently tracked employers (Moreno Valley: ALDI, Amazon,
Deckers Brands, Ross Dress for Less, Skechers U.S.A.; Broomfield: Ball
Corporation, Noodles & Company, Vail Resorts), only Amazon has any live
Adzuna postings at all, under two real observed legal-entity names
("Amazon.com Services LLC", "Amazon Delivery Service Partner"). The other
seven have ZERO matching postings under any name variant found in a full
scan of both towns' distinct `jobs.company` values -- not a matching-logic
gap, a real absence of Adzuna coverage for those employers today. Seeding a
guessed alias for them would violate the same "no invented data" principle
as everywhere else in this pipeline; left as employers' own migration
default (empty array) instead, exactly like facilities.name_aliases handles
a venue with no confirmed variant form (see seed_facility_name_aliases.py).

This is disclosed, not silently accepted: whether the *tracked employer
roster itself* should be broadened to match employers with real Adzuna
volume is a separate, future research question (the same shape of work as
Fas 3's event-source hunting -- identifying which employers actually have
postings, not just wiring up already-known ones) -- explicitly out of scope
here per the user's own decision to build the hiring layer against the
CURRENT employer lists, not to widen them.

Usage:
    python -m scripts.seed_employer_aliases           # dry run (default)
    python -m scripts.seed_employer_aliases --apply   # writes to DB
"""
from __future__ import annotations

import argparse

from db.db import get_conn

# (town_id, employer_slug) -> aliases to seed. Additive (see apply_seed --
# never overwrites an alias a human already added by hand).
SEED: dict[tuple[str, str], list[str]] = {
    ("moreno_valley_ca", "amazon"): [
        "Amazon.com Services LLC", "Amazon Delivery Service Partner",
    ],
}


def apply_seed(conn, apply: bool) -> None:
    with conn.cursor() as cur:
        for (town_id, slug), aliases in SEED.items():
            cur.execute(
                "SELECT aliases FROM employers WHERE town_id = %s AND slug = %s",
                (town_id, slug),
            )
            row = cur.fetchone()
            if row is None:
                print(f"  SKIP {town_id}/{slug}: no such employer")
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
                    "UPDATE employers SET aliases = %s WHERE town_id = %s AND slug = %s",
                    (merged, town_id, slug),
                )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                     help="Actually write aliases. Without this flag, only a "
                          "dry-run report is printed and nothing is written.")
    args = ap.parse_args()

    with get_conn() as conn:
        apply_seed(conn, args.apply)
        if not args.apply:
            print("\nDry run only -- nothing was written. Re-run with --apply to write.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
