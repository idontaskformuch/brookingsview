"""Events correctness Phase 1: retroactive cleanup for recurring-program
event stories published as many near-identical individual rows BEFORE
ai_pipeline/publish.py's group_recurring_events() existed, or before enough
occurrences existed at once in a single run to cross its threshold.
group_recurring_events() only ever sees the occurrences present together in
ONE run's read of the events table -- it has no way to know about an
occurrence some earlier run already published as its own separate stories
row. Confirmed live 2026-10-08: Moreno Valley's "Shop for a Cause
Fundraiser" has exactly one correct is_recurring_series canonical row
(created by the now-fixed pipeline) sitting alongside 226 old individual
rows for the exact same program, still rendering as 226 separate cards on
/events, /today and the homepage.

Scope, deliberately narrow: this only merges a duplicate-title group when a
MATCHING is_recurring_series=true row (same town, same exact title) already
exists to redirect to -- it never invents a new canonical slug. A handful of
duplicate-title groups found live have no such canonical row yet (their
occurrences never co-occurred >= _MIN_RECURRING_OCCURRENCES at once in any
single run since the fix shipped); those are left untouched and reported, to
be picked up by a future run of this same script once the live pipeline (or
a future run of this one) creates their canonical row -- not guessed at here
with a parallel slug scheme that could drift from what group_recurring_events()
would actually produce.

"Keep data, stop rendering" (per the AdSense/Mediavine remediation handoff's
global rules): no row is ever deleted. An old individual row gets
superseded_by_slug set to the canonical series row's slug (db/migrations/
051_event_series_supersede.sql); every event-listing query in site/src/lib/
db.ts now filters it out via that column (see Story's own doc comment).

Writes a redirect map (old slug -> canonical slug) to
site/server/event-series-redirects.json, same convention as
scripts/resolve_duplicate_meeting_slugs.py's legacy-meeting-redirects.json --
site/server/worker.ts reuses the exact same resolveLegacyMeetingRedirect()
pure function against this new map (it's a plain slug->slug lookup, nothing
meeting-specific about its behavior).

Usage:
    python -m scripts.merge_recurring_event_duplicates --dry-run
    python -m scripts.merge_recurring_event_duplicates
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai_pipeline.publish import _MIN_RECURRING_OCCURRENCES
from db.db import get_conn

REDIRECT_MAP_PATH = Path(__file__).resolve().parent.parent / "site" / "server" / "event-series-redirects.json"

TOWN_IDS = ["brookings_sd", "moreno_valley_ca", "broomfield_co"]


def find_duplicate_groups(conn, town_id: str) -> list[dict]:
    """Every (title) group of >= _MIN_RECURRING_OCCURRENCES individually-
    published, not-yet-superseded event rows for this town, with whether a
    matching canonical is_recurring_series row already exists."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT title, array_agg(slug ORDER BY occurs_at) AS slugs, count(*) AS n
              FROM stories
             WHERE town_id = %s AND source_type = 'event' AND published_at IS NOT NULL
               AND is_recurring_series IS NOT TRUE AND superseded_by_slug IS NULL
             GROUP BY title
            HAVING count(*) >= %s
             ORDER BY count(*) DESC
            """,
            (town_id, _MIN_RECURRING_OCCURRENCES),
        )
        rows = cur.fetchall()

    groups = []
    with conn.cursor() as cur:
        for title, slugs, n in rows:
            cur.execute(
                """SELECT slug FROM stories
                    WHERE town_id = %s AND source_type = 'event' AND is_recurring_series = true AND title = %s""",
                (town_id, title),
            )
            canonical = cur.fetchone()
            groups.append({
                "town_id": town_id, "title": title, "old_slugs": slugs, "count": n,
                "canonical_slug": canonical[0] if canonical else None,
            })
    return groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    all_groups: list[dict] = []
    with get_conn() as conn:
        for town_id in TOWN_IDS:
            all_groups.extend(find_duplicate_groups(conn, town_id))

        mergeable = [g for g in all_groups if g["canonical_slug"]]
        unresolved = [g for g in all_groups if not g["canonical_slug"]]

        print(f"{len(all_groups)} duplicate-title group(s) found across all towns "
              f"(>= {_MIN_RECURRING_OCCURRENCES} occurrences each).")
        print(f"  {len(mergeable)} have a matching canonical series row -- will be merged.")
        print(f"  {len(unresolved)} have NO canonical series row yet -- left untouched, reported below.")

        if unresolved:
            print("\nUnresolved (no canonical row to redirect to -- rerun this script later once one exists):")
            for g in unresolved:
                print(f"  {g['town_id']}: {g['count']:4d}x  {g['title']!r}")

        redirect_map: dict[str, str] = {}
        total_rows_updated = 0
        for g in mergeable:
            print(f"\n{g['town_id']}: {g['count']} old row(s) -> canonical {g['canonical_slug']!r}  ({g['title']!r})")
            for old_slug in g["old_slugs"]:
                redirect_map[old_slug] = g["canonical_slug"]
            total_rows_updated += len(g["old_slugs"])

        if args.dry_run:
            print(f"\n(dry-run -- {total_rows_updated} row(s) would be superseded, "
                  f"redirect map not written, nothing changed)")
            return 0

        with conn.cursor() as cur:
            for g in mergeable:
                cur.execute(
                    "UPDATE stories SET superseded_by_slug = %s WHERE town_id = %s AND slug = ANY(%s)",
                    (g["canonical_slug"], g["town_id"], g["old_slugs"]),
                )
        conn.commit()
        print(f"\nMarked {total_rows_updated} row(s) as superseded (data kept, rendering stopped).")

    # Merge into any existing map (idempotent re-runs shouldn't drop earlier
    # entries whose source groups are no longer "unresolved" at query time).
    existing: dict[str, str] = {}
    if REDIRECT_MAP_PATH.exists():
        existing = json.loads(REDIRECT_MAP_PATH.read_text(encoding="utf-8"))
    existing.update(redirect_map)
    REDIRECT_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    REDIRECT_MAP_PATH.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote redirect map ({len(existing)} entries total, {len(redirect_map)} new) to {REDIRECT_MAP_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
