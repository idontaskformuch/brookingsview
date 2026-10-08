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


def find_source_url_duplicate_groups(conn, town_id: str) -> list[dict]:
    """Events correctness Phase 1, point 2 (2026-10-08): a SEPARATE
    duplicate signal from find_duplicate_groups() above -- groups by
    source_url instead of title, with no occurrence-count minimum, to
    catch two live-confirmed shapes title-grouping misses entirely:

    1. A one-time event re-scraped after the organizer corrected its own
       date (e.g. Brookings "BPN October Meetup - Fly Boy Donuts": the
       same chamber listing URL scraped 3 times, the earliest run landing
       the ORIGINAL wrong date before a correction, 2 later runs landing
       the corrected one) -- content_hash keys on (source, uid) to stop
       this going forward, but doesn't retire an already-published stale
       row. Canonical here is whichever row has the latest published_at
       (the most recent scrape of the live source is the one that saw any
       correction).
    2. A single leftover individual row whose source_url matches an
       EXISTING is_recurring_series canonical row, even when there's only
       ONE such leftover -- below find_duplicate_groups()'s own >=
       _MIN_RECURRING_OCCURRENCES(3) threshold, so invisible to it.
       Confirmed live: Moreno Valley's "Monday Night Football" (Farm
       House Collective) had exactly one individual duplicate sitting
       next to its own correct series row. A recurring series' own
       source_url is NOT instance-specific for every source checked
       (Tockify's IS, via a per-session timestamp in the URL -- those
       never collide here; Farm House Collective's is a single evergreen
       per-program URL, which is exactly why this case exists).

    Grouped by (source_url, title) together, NOT source_url alone --
    confirmed live and caught before this ever ran for real: Brookings
    county alert/road-notice rows all cite the SAME generic
    "AlertCenter.aspx" landing page as their source_url for "more info,"
    so a bare source_url group lumped 4 genuinely different notices
    (a heat advisory, a street closure, shoulder work, a railroad
    crossing install) into one. Requiring the title to also match is
    exactly the guard that excludes that case while still catching Fly
    Boy Donuts/Monday Night Football (identical title AND source_url in
    both)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_url, title,
                   array_agg(slug ORDER BY published_at DESC) AS slugs_by_recency,
                   array_agg(is_recurring_series ORDER BY published_at DESC) AS series_flags,
                   count(*) AS n
              FROM stories
             WHERE town_id = %s AND source_type = 'event' AND published_at IS NOT NULL
               AND superseded_by_slug IS NULL AND source_url IS NOT NULL
             GROUP BY source_url, title
            HAVING count(*) > 1
             ORDER BY count(*) DESC
            """,
            (town_id,),
        )
        rows = cur.fetchall()

    groups = []
    for source_url, title, slugs, series_flags, n in rows:
        series_slugs = [s for s, is_series in zip(slugs, series_flags) if is_series]
        if len(series_slugs) > 1:
            groups.append({
                "town_id": town_id, "title": title, "source_url": source_url, "old_slugs": [], "count": n,
                "canonical_slug": None,
                "skip_reason": f"{len(series_slugs)} rows sharing this (source_url, title) are ALL "
                               f"is_recurring_series=true ({series_slugs!r}) -- needs manual review, not guessed at",
            })
            continue
        canonical_slug = series_slugs[0] if series_slugs else slugs[0]  # slugs[0] = most recent (DESC)
        old_slugs = [s for s in slugs if s != canonical_slug]
        groups.append({
            "town_id": town_id, "title": title, "source_url": source_url, "old_slugs": old_slugs, "count": n,
            "canonical_slug": canonical_slug,
        })
    return groups


def _run_pass(conn, groups: list[dict], dry_run: bool, label: str) -> tuple[dict[str, str], int]:
    mergeable = [g for g in groups if g.get("canonical_slug")]
    unresolved = [g for g in groups if not g.get("canonical_slug")]

    print(f"\n=== {label}: {len(groups)} group(s) found across all towns ===")
    print(f"  {len(mergeable)} will be merged.")
    print(f"  {len(unresolved)} left untouched, reported below.")
    for g in unresolved:
        reason = g.get("skip_reason", "no canonical row to redirect to yet")
        label_text = g.get("title") or g.get("source_url")
        print(f"  SKIP {g['town_id']}: {g['count']:4d}x  {label_text!r} -- {reason}")

    redirect_map: dict[str, str] = {}
    total = 0
    for g in mergeable:
        label_text = g.get("title") or g.get("source_url")
        print(f"  {g['town_id']}: {g['count']} row(s) -> canonical {g['canonical_slug']!r}  ({label_text!r})")
        for old_slug in g["old_slugs"]:
            redirect_map[old_slug] = g["canonical_slug"]
        total += len(g["old_slugs"])

    if not dry_run and mergeable:
        with conn.cursor() as cur:
            for g in mergeable:
                cur.execute(
                    "UPDATE stories SET superseded_by_slug = %s WHERE town_id = %s AND slug = ANY(%s)",
                    (g["canonical_slug"], g["town_id"], g["old_slugs"]),
                )
        conn.commit()
    return redirect_map, total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    redirect_map: dict[str, str] = {}
    with get_conn() as conn:
        # Strictly sequential, not pre-computed together: pass 2 must see
        # pass 1's writes (its own WHERE superseded_by_slug IS NULL) so it
        # never operates on a row pass 1 already resolved, and never
        # double-redirects the same slug to two different canonicals.
        title_groups: list[dict] = []
        for town_id in TOWN_IDS:
            title_groups.extend(find_duplicate_groups(conn, town_id))
        title_map, title_total = _run_pass(
            conn, title_groups, args.dry_run,
            f"Pass 1 -- recurring-title groups (>= {_MIN_RECURRING_OCCURRENCES} occurrences)",
        )
        redirect_map.update(title_map)

        source_url_groups: list[dict] = []
        for town_id in TOWN_IDS:
            source_url_groups.extend(find_source_url_duplicate_groups(conn, town_id))
        source_map, source_total = _run_pass(
            conn, source_url_groups, args.dry_run, "Pass 2 -- same source_url, re-scraped or leftover duplicate",
        )
        redirect_map.update(source_map)

        total_rows_updated = title_total + source_total
        if args.dry_run:
            print(f"\n(dry-run -- {total_rows_updated} row(s) would be superseded, "
                  f"redirect map not written, nothing changed)")
            return 0

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
