"""One-time cleanup for a single confirmed duplicate found live 2026-10-02
(item D3): Brookings' chamber_business source ("BPN October Meetup - Fly
Boy Donuts", source uid e.3606.1403836) was scraped twice with two
different starts_at values -- id 282132 (Oct 6, 2026, 7:30 AM Central) and
id 285103 (Oct 8, 2026, 7:30 AM Central) -- before event_sources.py's
content_hash was fixed to key on (source, uid) alone instead of including
starts_at/title (see that module's own comment on the fix). The live
Chamber source confirms Oct 6 is correct; Oct 8 is the stale row from
before the correction.

This is a ONE-TIME removal of data that predates the content_hash fix --
the fix itself prevents this class of duplicate going forward (a future
re-scrape updates the existing row in place instead of inserting a new
one), it doesn't retroactively clean up rows that already exist.

Usage:
    python -m scripts.remove_duplicate_bpn_october_meetup --dry-run
    python -m scripts.remove_duplicate_bpn_october_meetup
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from db.db import get_conn

TOWN_ID = "brookings_sd"
STALE_EVENT_ID = 285103
EXPECTED_TITLE = "BPN October Meetup - Fly Boy Donuts"
EXPECTED_UID = "e.3606.1403836"
EXPECTED_STALE_STARTS_AT = datetime(2026, 10, 8, 12, 30, tzinfo=timezone.utc)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, town_id, title, starts_at, raw_data FROM events WHERE id = %s",
                (STALE_EVENT_ID,),
            )
            row = cur.fetchone()

        if row is None:
            print(f"id={STALE_EVENT_ID}: not found -- already removed, or never existed. Nothing to do.")
            return 0

        event_id, town_id, title, starts_at, raw_data = row
        uid = (raw_data or {}).get("uid")
        print(f"Found id={event_id}: town={town_id!r} title={title!r} starts_at={starts_at} uid={uid!r}")

        # Hard-verify every identifying field before deleting anything --
        # this script's whole job is removing exactly ONE specific row, not
        # "whatever currently has this id".
        mismatches = []
        if town_id != TOWN_ID:
            mismatches.append(f"town_id: expected {TOWN_ID!r}, got {town_id!r}")
        if title != EXPECTED_TITLE:
            mismatches.append(f"title: expected {EXPECTED_TITLE!r}, got {title!r}")
        if uid != EXPECTED_UID:
            mismatches.append(f"uid: expected {EXPECTED_UID!r}, got {uid!r}")
        if starts_at != EXPECTED_STALE_STARTS_AT:
            mismatches.append(f"starts_at: expected {EXPECTED_STALE_STARTS_AT}, got {starts_at}")
        if mismatches:
            print("REFUSING to delete -- row no longer matches what this script expects:")
            for m in mismatches:
                print(f"  - {m}")
            print("(the row may have already been corrected by a later scrape -- check manually)")
            return 1

        backup_dir = Path("backups")
        backup_dir.mkdir(exist_ok=True)
        backup_path = backup_dir / f"removed_event_{event_id}.json"
        backup_path.write_text(
            json.dumps({"id": event_id, "town_id": town_id, "title": title,
                        "starts_at": starts_at.isoformat(), "raw_data": raw_data}, indent=2),
            encoding="utf-8",
        )
        print(f"Backed up the full row to {backup_path} before deleting.")

        if args.dry_run:
            print("(dry-run -- not deleted)")
            return 0

        with conn.cursor() as cur:
            cur.execute("DELETE FROM events WHERE id = %s", (event_id,))
        print(f"Deleted id={event_id}.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
