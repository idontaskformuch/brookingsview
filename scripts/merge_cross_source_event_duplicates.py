"""QA finding #3 (2026-10): retroactive cleanup for the SAME real event
scraped via two different source paths BEFORE ai_pipeline.publish's
dedupe_cross_source_events() existed -- confirmed live triple-rendered on
Brookings' homepage for one real Saturday event ("Community Art Day",
three different `source` values -- see .claude/qa-audit-2026-10.md finding
#3). Same "keep data, stop rendering" discipline as
scripts/merge_recurring_event_duplicates.py: no row is ever deleted, a
loser gets superseded_by_slug set to the winner's slug, and the old URL
301s at the edge (worker.ts) rather than 404ing or staying live.

Reuses the EXACT SAME shared clustering primitive as the live pipeline fix
(ai_pipeline.publish.cluster_event_duplicate_indices()) so this backfill
can never drift from what the ongoing pipeline now does going forward --
a group found here is, by construction, exactly a group dedupe_cross_
source_events() would have collapsed had it existed when these rows were
first published. See that function's own docstring for the clustering
rule (title+day+venue-COMPATIBILITY, not exact venue match -- a row with
no venue info merges into a cluster with one resolved named venue, since
absence isn't a contradiction; two or more DIFFERENT named venues in one
title+day bucket is a real conflict, never guessed at).

KNOWN LIMITATION (same as the live fix, same reasoning): exact-title
match only, after strip_slot()+lowercasing. The live triple-duplicate
case's near-miss third row ("Free Community Art Day" vs "Community Art
Day", same real event) is NOT caught here either, by design -- fuzzy
title matching risks merging two genuinely different events. Left
untouched, reported separately so a human can decide.

Winner selection within a matched group: prefers a row whose venue
resolves to a real registered facility (richer, structurally-usable row
-- map/venue-page linking, JSON-LD Place -- live case: event-282136 had
no venue_raw at all; event-305361, the same real event, resolved cleanly
to South Dakota Art Museum), then the longest `body`, tying on EARLIEST
published_at (the longest-live, most likely already-indexed URL stays
canonical -- minimizes churn for any existing backlink/bookmark).

Writes into the SAME redirect map scripts/merge_recurring_event_
duplicates.py already uses (site/server/event-series-redirects.json) --
worker.ts's own comment is explicit that "event dupes stay in event-
series-redirects.json" regardless of which script produced them, so this
reuses that file rather than adding a second one worker.ts would need to
also read.

Usage:
    python -m scripts.merge_cross_source_event_duplicates --dry-run
    python -m scripts.merge_cross_source_event_duplicates
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from psycopg.rows import dict_row

from ai_pipeline.publish import cluster_event_duplicate_indices
from ai_pipeline.venue_registry import load_registry, resolve_venue
from db.db import get_conn

REDIRECT_MAP_PATH = Path(__file__).resolve().parent.parent / "site" / "server" / "event-series-redirects.json"

# Mirrors site/src/lib/site-config.ts's per-town timezone -- kept here
# rather than importing TS, same duplication this codebase already
# accepts elsewhere (see venue_registry.py <-> db.ts's own comment).
TOWN_TIMEZONES = {
    "brookings_sd": "America/Chicago",
    "moreno_valley_ca": "America/Los_Angeles",
    "broomfield_co": "America/Denver",
}
TOWN_IDS = list(TOWN_TIMEZONES)


def find_duplicate_story_groups(conn, town_id: str, venue_registry: dict, tz: ZoneInfo) -> list[dict]:
    """Every group of >= 2 already-published, not-yet-superseded event
    stories for this town that dedupe_cross_source_events() would
    collapse if it saw these rows today -- same clustering rule, via the
    SAME shared primitive (cluster_event_duplicate_indices()), so this
    backfill can never drift from what the live pipeline does. venue_
    registry/tz are passed in (not loaded here) so this stays unit-
    testable with a plain dict, same reasoning as ai_pipeline.publish's
    own dedupe_cross_source_events() taking venue_registry as a
    parameter rather than loading it itself."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT slug, title, venue_raw, occurs_at, published_at, length(coalesce(body, '')) AS body_len
              FROM stories
             WHERE town_id = %s AND source_type = 'event' AND published_at IS NOT NULL
               AND superseded_by_slug IS NULL AND is_recurring_series IS NOT TRUE
               AND occurs_at IS NOT NULL
             ORDER BY id
            """,
            (town_id,),
        )
        rows = cur.fetchall()

    items = [(r["title"], r["occurs_at"].astimezone(tz).date().isoformat(), r["venue_raw"]) for r in rows]

    results = []
    for idxs in cluster_event_duplicate_indices(items, venue_registry):
        if len(idxs) < 2:
            continue
        members = [rows[i] for i in idxs]
        winner = max(members, key=lambda r: (
            resolve_venue(venue_registry, r["venue_raw"]) is not None,
            r["body_len"],
            -r["published_at"].timestamp(),
        ))
        loser_slugs = [m["slug"] for m in members if m["slug"] != winner["slug"]]
        results.append({
            "town_id": town_id, "title": members[0]["title"], "day": items[idxs[0]][1], "count": len(members),
            "winner_slug": winner["slug"], "loser_slugs": loser_slugs,
        })
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    redirect_map: dict[str, str] = {}
    total = 0
    with get_conn() as conn:
        groups: list[dict] = []
        for town_id in TOWN_IDS:
            tz = ZoneInfo(TOWN_TIMEZONES[town_id])
            venue_registry = load_registry(conn, town_id)
            groups.extend(find_duplicate_story_groups(conn, town_id, venue_registry, tz))

        print(f"\n=== Cross-source event duplicates: {len(groups)} group(s) found across all towns ===")
        for g in groups:
            print(f"  {g['town_id']}: {g['count']}x {g['title']!r} on {g['day']} "
                  f"-> keep {g['winner_slug']!r}, supersede {g['loser_slugs']!r}")
            for loser_slug in g["loser_slugs"]:
                redirect_map[loser_slug] = g["winner_slug"]
            total += len(g["loser_slugs"])

        if args.dry_run:
            print(f"\n(dry-run -- {total} row(s) would be superseded, "
                  f"redirect map not written, nothing changed)")
            return 0

        if groups:
            with conn.cursor() as cur:
                for g in groups:
                    cur.execute(
                        "UPDATE stories SET superseded_by_slug = %s WHERE town_id = %s AND slug = ANY(%s)",
                        (g["winner_slug"], g["town_id"], g["loser_slugs"]),
                    )
            conn.commit()
        print(f"\nMarked {total} row(s) as superseded (data kept, rendering stopped).")

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
