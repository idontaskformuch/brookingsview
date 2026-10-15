"""QA finding #5 (2026-10): retroactive fix for ai_pipeline/publish.py's
build_title() quorum-notice bug (fixed in the same change as this script) --
the quorum-notice branch never appended the meeting date at all, unlike the
regular-meeting fallback two lines below it in the same function. Every
quorum-notice story published before that fix is missing its date suffix,
not just the 5 that happened to collide on an identical title (a recurring
real event, e.g. "Downtown at Sundown").

Recomputes each affected story's title by calling the NOW-FIXED build_title()
directly against its own underlying meetings row (raw_data/meeting_date),
rather than hand-deriving the date -- guarantees the backfilled title is
byte-identical to what a fresh publish run would produce today, not a
second, possibly-drifting implementation of the same format.

Scope: every published, not-yet-superseded source_type='meeting' story
whose title starts with "Notice: possible quorum" (the fixed function's own
literal prefix). Title-only UPDATE -- never touches slug, occurs_at, body,
or any other column; the title was simply wrong, not the data behind it.

SAFETY CHECK, found live running this (2026-10-15): re-running build_title()
against a meeting's CURRENT meetings.raw_data can disagree with the
classification that produced the story's ORIGINAL title, for 5 of the 28
candidates here -- is_quorum_notice_only() now returns False for them
because raw_data.agenda_text is NULL today, even though the existing title
proves it had real agenda content when first published. Root cause: a
Legistar rescrape of a sufficiently old EventId can return zero agenda
items, and legistar_v1.py's upsert REPLACES raw_data wholesale (update_
columns includes "raw_data"), overwriting the richer historical content
with an impoverished version -- a separate, real data-loss bug, not fixed
here. Only a row whose recomputed title STILL starts with "Notice: possible
quorum" is ever updated; the other kind (reclassified to a generic meeting
title) is reported separately and never touched, since applying it would
replace a correct, specific label with a misleading generic one.

Usage:
    python -m scripts.backfill_quorum_notice_title_dates --dry-run
    python -m scripts.backfill_quorum_notice_title_dates
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai_pipeline.publish import build_title
from db.db import get_conn

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


def find_affected_stories(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.slug, s.title, s.town_id, m.body, m.meeting_date, m.raw_data
              FROM stories s
              JOIN meetings m ON m.id = s.meeting_id
             WHERE s.source_type = 'meeting' AND s.published_at IS NOT NULL
               AND s.superseded_by_slug IS NULL
               AND s.title LIKE 'Notice: possible quorum%'
             ORDER BY s.id
            """
        )
        rows = cur.fetchall()
    return [
        {"id": r[0], "slug": r[1], "old_title": r[2], "town_id": r[3], "body": r[4], "meeting_date": r[5], "raw_data": r[6]}
        for r in rows
    ]


_CFG_CACHE: dict[str, dict] = {}


def _cfg_for_town(town_id: str) -> dict:
    if town_id not in _CFG_CACHE:
        _CFG_CACHE[town_id] = json.loads((CONFIG_DIR / f"{town_id}.json").read_text(encoding="utf-8"))
    return _CFG_CACHE[town_id]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        stories = find_affected_stories(conn)
        changes = []
        reclassified = []
        for s in stories:
            cfg = _cfg_for_town(s["town_id"])
            row = {"body": s["body"], "meeting_date": s["meeting_date"], "raw_data": s["raw_data"]}
            new_title = build_title("meetings", row, cfg)
            if new_title == s["old_title"]:
                continue
            if new_title.startswith("Notice: possible quorum"):
                changes.append({**s, "new_title": new_title})
            else:
                # See module docstring's "SAFETY CHECK" -- current raw_data
                # no longer supports the quorum classification. Reported,
                # never applied.
                reclassified.append({**s, "new_title": new_title})

        print(f"\n=== Quorum-notice title backfill: {len(stories)} candidate(s), {len(changes)} will be updated ===")
        for c in changes:
            print(f"  {c['slug']}:")
            print(f"    old: {c['old_title']!r}")
            print(f"    new: {c['new_title']!r}")

        if reclassified:
            print(f"\n=== {len(reclassified)} row(s) SKIPPED -- current raw_data no longer supports the "
                  f"quorum classification (see module docstring's SAFETY CHECK), never applied ===")
            for c in reclassified:
                print(f"  {c['slug']}: {c['old_title']!r} -> would reclassify as {c['new_title']!r}, left untouched")

        if args.dry_run:
            print(f"\n(dry-run -- {len(changes)} row(s) would be updated, nothing changed)")
            return 0

        if changes:
            with conn.cursor() as cur:
                for c in changes:
                    cur.execute("UPDATE stories SET title = %s WHERE id = %s", (c["new_title"], c["id"]))
            conn.commit()
        print(f"\nUpdated {len(changes)} row(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
