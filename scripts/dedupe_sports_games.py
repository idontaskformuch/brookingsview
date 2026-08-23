"""One-time cleanup for sports_games rows duplicated by the ranking-prefix
bug fixed in scrapers/parsers/gojacks_v1.py (see NEEDS-HUMAN-REVIEW.md
"University Coverage Rebuild"): content_hash used to be keyed on the raw,
ranking-prefixed opponent name ("#1 Nebraska" vs "Nebraska"), so a poll
update between scrapes inserted a second row for what was really the same
game instead of updating the first.

The parser fix (normalize_opponent() in content_hash going forward) only
prevents NEW duplicates -- rows already sitting in the table from before the
fix keep their old, now-stale content_hash forever, AND (a real consequence
of changing what content_hash is keyed on) the FIRST re-scrape after this
fix ships produces a second, freshly-hashed row for every previously-ranked
opponent instead of updating the old one in place. Both need a one-time
merge, safe to re-run.

Groups by (town_id, sport, normalized opponent), THEN clusters rows within
a group by time proximity (within TZ_BUG_WINDOW_HOURS of each other) rather
than by calendar date -- SDSU basketball plays true home-and-away rematches
against the same conference opponent (confirmed live: Omaha, North Dakota,
Denver, etc. all appear twice a season, ~30 days apart, which are REAL
distinct games, not duplicates). The actual bug signature is two rows for
the same opponent only ~5-6 hours apart (exactly the naive-datetime-as-UTC
offset) -- a real rematch is never that close together.

Within a duplicate group, keeps the row with:
  1. a non-null result, if only one of the group has one (never discard a
     real score to keep an emptier row);
  2. otherwise, the most information-rich opponent label (the one WITH a
     ranking prefix, since "#1 Nebraska" is strictly more informative than
     "Nebraska" for a reader -- picked by raw length, longest wins);
  3. otherwise, the most recently created row.
Deletes the rest.

Usage:
    python -m scripts.dedupe_sports_games                  # apply
    python -m scripts.dedupe_sports_games --dry-run         # preview only
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import timedelta

from db.db import get_conn
from scrapers.parsers.gojacks_v1 import normalize_opponent

# The naive-datetime-as-UTC bug is off by exactly the Central UTC offset (5h
# CDT / 6h CST) -- confirmed live: all 4 real instances found were exactly
# 5h apart. 8h gives margin above that while staying well under both
# "~24h apart" (a real back-to-back tournament game sharing a placeholder
# opponent name, e.g. "Brawl on Bourbon Street" Nov 28 AND Nov 29 -- verified
# these are two distinct real games, not a duplicate) and "~30 days apart"
# (a real conference home-and-away rematch).
TZ_BUG_WINDOW_HOURS = 8


def _cluster_by_proximity(rows: list[dict]) -> list[list[dict]]:
    """rows sorted by starts_at, same (sport, normalized opponent) already --
    split into clusters where consecutive rows are within the bug window."""
    rows = sorted(rows, key=lambda r: r["starts_at"])
    clusters: list[list[dict]] = [[rows[0]]]
    for row in rows[1:]:
        if row["starts_at"] - clusters[-1][-1]["starts_at"] <= timedelta(hours=TZ_BUG_WINDOW_HOURS):
            clusters[-1].append(row)
        else:
            clusters.append([row])
    return [c for c in clusters if len(c) > 1]


def find_duplicate_groups(conn, town_id: str) -> list[list[dict]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, sport, opponent, starts_at, result, created_at
              FROM sports_games
             WHERE town_id = %s AND starts_at IS NOT NULL
             ORDER BY starts_at
            """,
            (town_id,),
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    by_opponent: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        key = (row["sport"], normalize_opponent(row["opponent"]))
        by_opponent[key].append(row)

    groups: list[list[dict]] = []
    for rows_for_opponent in by_opponent.values():
        groups.extend(_cluster_by_proximity(rows_for_opponent))
    return groups


def choose_keeper(group: list[dict]) -> dict:
    with_result = [r for r in group if r["result"]]
    if len(with_result) == 1:
        return with_result[0]
    pool = with_result or group
    # Longest opponent label first (most informative -- keeps a rank prefix
    # over a bare name), ties broken by most recently created.
    return sorted(pool, key=lambda r: (len(r["opponent"]), r["created_at"]), reverse=True)[0]


def dedupe_town(conn, town_id: str, dry_run: bool) -> int:
    groups = find_duplicate_groups(conn, town_id)
    deleted = 0
    for group in groups:
        keeper = choose_keeper(group)
        losers = [r for r in group if r["id"] != keeper["id"]]
        opponents = {r["opponent"] for r in group}
        print(f"  {town_id}: {group[0]['sport']} {group[0]['starts_at'].date()} "
              f"{opponents} -> keeping id={keeper['id']} ({keeper['opponent']!r})")
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM sports_games WHERE id = ANY(%s)",
                    ([r["id"] for r in losers],),
                )
        deleted += len(losers)
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--town", default="brookings_sd")
    args = ap.parse_args()

    with get_conn() as conn:
        deleted = dedupe_town(conn, args.town, args.dry_run)
        if args.dry_run:
            print(f"\n(dry-run) would delete {deleted} duplicate row(s)")
        else:
            conn.commit()
            print(f"\nDeleted {deleted} duplicate row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
