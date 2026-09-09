"""Image pool rotation (Addendum 2, 2026-09-09) -- assigns each newly
scraped story a durable slot in its category's image pool, via a true
incrementing counter per (town_id, category), instead of leaving every
story to resolveImage()'s own stable-but-hash-based pick.

WHY THIS EXISTS: site/src/lib/images.ts's pickFromPool() already picks a
category image deterministically from a per-item hash (same story always
gets the same image, no flicker on rebuild) -- but a hash has no memory of
what the PREVIOUS story picked, so two stories published close together can
land on the same pool slot by chance. This script gives new stories a real
round-robin slot instead: (town_id, category)'s own counter in
category_image_rotation advances by exactly 1 each time a story is
assigned, and that raw value is stored permanently on the story
(stories.category_image_index) -- never reassigned afterward, same
"assign once, keep forever" stability the hash approach already had.

Deliberately NOT modded against a pool size here: this script has no
reason to know how many images are in a pool (that lives in
site/src/config/category-images.ts, a TypeScript file). The read side
(images.ts's resolveImage()) takes `stored_index % pool.length` at build
time instead, where pool.length is naturally available -- see
db/migrations/043_category_image_rotation.sql's own comment.

CATEGORY_BY_SOURCE_TYPE below is a deliberate, hand-kept port of
site/src/lib/images.ts's own dict of the same name -- same cross-layer
duplication this codebase already accepts for e.g. Ticketmaster ranking
(ai_pipeline/event_deck_digest.py mirrors site/src/lib/whats-on.ts the same
way), not a new pattern. Keep the two in sync by hand; a mismatch only
means a story falls back to the old hash-pick (resolveImage() degrades
gracefully on a NULL category_image_index), never a build failure.

Piggybacks the existing 6-hour scrape cron per town (same reasoning
ai_pipeline/closure_watch_digest.py and ai_pipeline/event_deck_digest.py
already use) rather than a new per-insertion-site hook -- INSERT INTO
stories happens independently in eleven different files across this
pipeline with no single chokepoint to wire a call into; scanning broadly
for "any story that needs a slot and hasn't got one yet" sidesteps that
fan-out entirely, at the cost of up to one cron cycle's delay between a
story being published and getting its rotation slot (during which it
renders via the existing hash-pick fallback -- never imageless).

Usage:
    python -m ai_pipeline.assign_category_image_rotation --config configs/brookings_sd.json --dry-run
    python -m ai_pipeline.assign_category_image_rotation --config configs/brookings_sd.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

from db.db import get_conn

# Hand-kept port of site/src/lib/images.ts's CATEGORY_BY_SOURCE_TYPE --
# see this module's own docstring for why this duplication is deliberate.
# Only source_types that ever reach resolveImage() tier 4 (no image_path of
# their own, no dedicated content-track illustration) appear here.
CATEGORY_BY_SOURCE_TYPE: dict[str, str] = {
    "meeting": "city_hall",
    "meeting_followup": "city_hall",
    "event": "events",
    "weekly": "events",
    "alert": "weather_alert",
    "home_sales_digest": "home_sales",
    "sports_digest": "sports",
    "local_sports_digest": "sports",
    "jackrabbits_season_summary": "sports",
    "university_digest": "university",
    "workplace_watch_digest": "workplace_watch",
}


def _next_index(cur, town_id: str, category: str) -> int:
    """Atomically advances (town_id, category)'s own counter by 1 and
    returns the NEW value -- a single INSERT .. ON CONFLICT .. RETURNING,
    so two rows in the same category never race each other onto the same
    slot even though this script processes them in a plain Python loop."""
    cur.execute(
        """
        INSERT INTO category_image_rotation (town_id, category, last_index)
        VALUES (%s, %s, 0)
        ON CONFLICT (town_id, category)
        DO UPDATE SET last_index = category_image_rotation.last_index + 1,
                      updated_at = now()
        RETURNING last_index
        """,
        (town_id, category),
    )
    return cur.fetchone()[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true", help="Print what would be assigned, write nothing.")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source_type FROM stories
                WHERE town_id = %s AND image_path IS NULL AND category_image_index IS NULL
                ORDER BY created_at ASC
                """,
                (town_id,),
            )
            pending = cur.fetchall()

        if not pending:
            print(f"[{town_id}] no stories pending a category-image rotation slot")
            return 0

        assigned = 0
        skipped = 0
        for story_id, source_type in pending:
            category = CATEGORY_BY_SOURCE_TYPE.get(source_type)
            if category is None:
                # No category for this source_type (e.g. a content-track type
                # that reached here despite normally having its own
                # image_path) -- nothing to assign, not an error.
                skipped += 1
                continue

            if args.dry_run:
                print(f"  [{town_id}] story {story_id} ({source_type} -> {category}): would assign next slot")
                assigned += 1
                continue

            with conn.cursor() as cur:
                index = _next_index(cur, town_id, category)
                cur.execute(
                    "UPDATE stories SET category_image_index = %s WHERE id = %s",
                    (index, story_id),
                )
            assigned += 1

        print(f"[{town_id}] {assigned} slot(s) assigned, {skipped} skipped (no category)"
              + (" (dry-run, nothing written)" if args.dry_run else ""))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
