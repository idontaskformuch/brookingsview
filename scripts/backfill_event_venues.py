"""One-time backfill: populate stories.venue_raw/ends_at for event stories
published BEFORE db/migrations/020_event_venue_resolution.sql added those
columns. ai_pipeline.publish.py only fills them for NEWLY published rows
going forward (existing rows are never re-touched, by design -- see that
module's docstring on idempotency); without this backfill, every
already-published event page would silently get zero Event JSON-LD forever,
not just until its next natural republish (which never happens).

Also seeds venue_review_queue with real historical occurrence counts using
the same resolve-or-queue logic publish.py now runs for new events, so a
human triaging the queue starts from the real picture instead of an empty
list that only grows from today.

Usage:
    python -m scripts.backfill_event_venues --config configs/moreno_valley_ca.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai_pipeline.venue_registry import load_registry, queue_for_review, resolve_venue
from db.db import get_conn


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    with get_conn() as conn:
        # slug format for a non-series event story is "event-<events.id>"
        # (ai_pipeline/publish.py: slug = f"{source_type}-{row['id']}") --
        # extract the id and join straight back to the source table for its
        # venue/ends_at. Series stories ("series-<hash>") are excluded: as
        # of this backfill none have ever actually been published (checked
        # directly against the live DB), and even if one existed it
        # wouldn't get a venue_raw anyway (see publish.py + [slug].astro on
        # why series pages skip Event JSON-LD entirely).
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, e.venue, e.ends_at
                  FROM stories s
                  JOIN events e
                    ON e.town_id = s.town_id
                   AND e.id = substring(s.slug FROM '^event-([0-9]+)$')::bigint
                 WHERE s.town_id = %s AND s.source_type = 'event'
                   AND s.venue_raw IS NULL AND s.slug ~ '^event-[0-9]+$'
                """,
                (town_id,),
            )
            rows = cur.fetchall()

        registry = load_registry(conn, town_id)
        updated = resolved_count = queued_count = 0
        for story_id, venue, ends_at in rows:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE stories SET venue_raw = %s, ends_at = %s WHERE id = %s",
                    (venue, ends_at, story_id),
                )
            updated += 1
            if venue:
                if resolve_venue(registry, venue) is not None:
                    resolved_count += 1
                else:
                    queue_for_review(conn, town_id, venue)
                    queued_count += 1
        conn.commit()

    print(f"Backfilled venue_raw/ends_at for {updated} event stories")
    print(f"  resolved against facilities registry: {resolved_count}")
    print(f"  queued for human review (unresolved):  {queued_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
