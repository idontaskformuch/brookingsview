"""One-time backfill for meetings.meeting_date rows written before the
2026-09-30 timezone fix to scrapers/parsers/escribe_v1.py (Moreno Valley
eSCRIBE's naive-datetime bug -- see that commit). Moreno Valley ONLY.

Brookings/Legistar is NOT touched: its meeting_date was always correctly a
bare calendar date, never wrong.

Broomfield/AgendaLink is NOT touched either -- a same-day-earlier version
of this script also targeted Broomfield, on the theory that its
scheduleTime field was authoritative and scheduleIso was computed against
the wrong timezone. That diagnosis was wrong (never checked against an
independent, non-AgendaLink source) and has since been corrected: verified
DIRECTLY against broomfield.org's own CivicEngage calendar that scheduleIso
(what agendalink_v1.py has always stored into meeting_date, unchanged) is
the accurate field, and scheduleTime has its own independent ~1-hour error.
Broomfield's meeting_date in the DB was therefore NEVER actually wrong --
only the site's DISPLAY of it was (see db.ts's formatMeetingDate() fix) --
so there is nothing here for Broomfield to backfill.

Recomputes meeting_date from each row's OWN already-stored raw_data (no
re-scraping needed), using the exact same, now-fixed parsing function the
scraper itself uses: raw_data->>'StartDate' via escribe_v1._parse_escribe_date().

Before any real run, exports every affected row (id, body, old value, new
value) to a timestamped JSON file so the change is reviewable and
reversible.

Usage:
    python -m scripts.backfill_meeting_date_from_raw_data --dry-run
    python -m scripts.backfill_meeting_date_from_raw_data   # real run, writes a backup file first
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from db.db import get_conn
from scrapers.parsers.escribe_v1 import _parse_escribe_date

TOWN_ID = "moreno_valley_ca"
TIMEZONE = "America/Los_Angeles"

BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def find_changed_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, town_id, body, meeting_date, raw_data
              FROM meetings
             WHERE town_id = %s
             ORDER BY meeting_date
            """,
            (TOWN_ID,),
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]

    changed = []
    for row in rows:
        raw_data = row["raw_data"]
        if isinstance(raw_data, str):
            raw_data = json.loads(raw_data)
        new_dt = _parse_escribe_date((raw_data or {}).get("StartDate"), TIMEZONE)
        if new_dt is None:
            continue  # can't recompute -- leave untouched, don't guess
        old_dt = row["meeting_date"]
        if new_dt.isoformat() == old_dt.isoformat():
            continue  # already correct (or already re-scraped since the fix)
        changed.append({
            "id": row["id"], "town_id": row["town_id"], "body": row["body"],
            "old": old_dt, "new": new_dt,
        })
    return changed


def write_backup(changed: list[dict]) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"meeting_date_backfill_{TOWN_ID}_{stamp}.json"
    payload = [
        {
            "id": row["id"], "town_id": row["town_id"], "body": row["body"],
            "old_meeting_date": row["old"].isoformat(), "new_meeting_date": row["new"].isoformat(),
        }
        for row in changed
    ]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sample", type=int, default=10, help="rows to print in the summary")
    args = parser.parse_args()

    with get_conn() as conn:
        changed = find_changed_rows(conn)
        if not changed:
            print(f"No meeting_date rows need correcting for {TOWN_ID} -- nothing to do.")
            return

        print(f"=== {TOWN_ID}: {len(changed)} row(s) would change ===")
        for row in changed[: args.sample]:
            print(f"  id={row['id']:<6} {row['body']!r}")
            print(f"    before: {row['old'].isoformat()}")
            print(f"    after:  {row['new'].isoformat()}")
        if len(changed) > args.sample:
            print(f"  ... and {len(changed) - args.sample} more")

        if args.dry_run:
            print("\n--dry-run: no changes written, no backup file created.")
            return

        backup_path = write_backup(changed)
        print(f"\nBacked up {len(changed)} row(s) to {backup_path}")

        with conn.cursor() as cur:
            for row in changed:
                cur.execute(
                    "UPDATE meetings SET meeting_date = %s WHERE id = %s",
                    (row["new"], row["id"]),
                )
        print(f"Updated meeting_date on {len(changed)} row(s).")


if __name__ == "__main__":
    main()
