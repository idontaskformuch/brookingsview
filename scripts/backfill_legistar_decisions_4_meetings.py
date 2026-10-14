"""One-time backfill for 4 specific Legistar (Brookings) meetings whose
meetings.raw_data.agenda_items predate Phase 7's vote-fetching code (see
ai_pipeline/meeting_decisions_legistar.py) and so carry none of
EventItemId/EventItemPassedFlagName/EventItemMatterId/votes -- the fields
meeting_decisions_legistar.py needs to populate meeting_decisions.

Owner-requested targets (EventIds): 3540, 3365, 3368, 3470. Confirmed live
against webapi.legistar.com/v1/cityofbrookings before writing this script:
only EventId 3540 (City Council, 2026-08-25, meetings.id 11005) has an
existing meetings row -- 3365 (2026-04-07), 3368 (2026-01-06) and 3470
(2025-04-01) predate this town's earliest scraped meeting row
(2026-06-18) and have NEVER been scraped into the DB at all. Per the
owner's own scope for this step ("bara berikning av befintliga
mötesrader... inga nya stories") this script ONLY touches rows that
already exist -- it does not create meetings rows, so 3365/3368/3470 are
reported as skipped, not backfilled, until the owner decides on that
separately (see steg 2).

For each in-scope EventId: re-fetches eventitems + votes directly from the
Legistar API (same calls as scrapers/parsers/legistar_v1.py and
scripts/verify_meeting_decisions_legistar.py), re-derives the cleaned
agenda_items via legistar_v1._clean_item (one implementation, no drift),
merges the result into that meeting's raw_data.agenda_items (content_hash
and every other meetings column left untouched), then upserts
meeting_decisions via ai_pipeline.meeting_decisions_legistar.upsert_decision
-- identical logic the regular scheduled pipeline uses, just pointed at
these 4 historical EventIds instead of whatever the last 30-day fetch saw.

Before any real run, exports each affected meeting's OLD raw_data to a
timestamped JSON backup (same convention as
scripts/backfill_meeting_date_from_raw_data.py) so the change is reviewable
and reversible.

Usage:
    python -m scripts.backfill_legistar_decisions_4_meetings --dry-run
    python -m scripts.backfill_legistar_decisions_4_meetings   # real run, writes a backup file first
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import os

from db.db import get_conn
from scrapers.parsers.legistar_v1 import _clean_item, _items_to_text, MAX_AGENDA_TEXT_CHARS, WEBAPI
from ai_pipeline.meeting_decisions_legistar import dedupe_shadow_items, outcome_from_item, upsert_decision

import requests

CLIENT = "cityofbrookings"
TOWN_ID = "brookings_sd"
EVENT_IDS = [3540, 3365, 3368, 3470]
FETCH_DELAY_SECONDS = 0.25

BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def _headers() -> dict:
    return {
        "Accept": "application/json",
        "User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)"),
    }


def fetch_event_items_with_votes(event_id: int) -> list[dict]:
    r = requests.get(f"{WEBAPI}/{CLIENT}/events/{event_id}/eventitems",
                      params={"AgendaNote": "1"}, headers=_headers(), timeout=30)
    r.raise_for_status()
    items = r.json()
    for item in items:
        if not item.get("EventItemMatterId") or not item.get("EventItemPassedFlagName"):
            continue
        item_id = item.get("EventItemId")
        vr = requests.get(f"{WEBAPI}/{CLIENT}/eventitems/{item_id}/votes",
                           headers=_headers(), timeout=30)
        if vr.status_code == 200:
            item["_votes"] = vr.json()
        time.sleep(FETCH_DELAY_SECONDS)
    return items


def find_meeting_row(conn, event_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, raw_data FROM meetings WHERE town_id = %s AND raw_data->>'EventId' = %s",
            (TOWN_ID, str(event_id)),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "raw_data": row[1]}


def build_new_raw_data(raw_data: dict, raw_items: list[dict]) -> dict:
    cleaned = [_clean_item(i) for i in raw_items]
    new_raw = dict(raw_data)
    new_raw["agenda_items"] = cleaned
    agenda_text = _items_to_text(raw_items)
    if agenda_text:
        new_raw["agenda_text"] = agenda_text[:MAX_AGENDA_TEXT_CHARS]
    return new_raw


def write_backup(entries: list[dict]) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"legistar_decisions_4_meetings_backfill_{stamp}.json"
    path.write_text(json.dumps(entries, indent=2, default=str), encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    plan: list[dict] = []
    with get_conn() as conn:
        for event_id in EVENT_IDS:
            meeting = find_meeting_row(conn, event_id)
            if not meeting:
                plan.append({"event_id": event_id, "status": "skipped_no_existing_row"})
                continue

            raw_items = fetch_event_items_with_votes(event_id)
            items = dedupe_shadow_items([_clean_item(i) for i in raw_items])
            decisions_preview = []
            for item in items:
                if not item.get("EventItemId") or not item.get("EventItemMatterId"):
                    continue
                decisions_preview.append({
                    "agenda_number": item.get("EventItemAgendaNumber"),
                    "title": item.get("EventItemTitle"),
                    "outcome": outcome_from_item(item),
                })
            plan.append({
                "event_id": event_id,
                "status": "will_enrich",
                "meeting_id": meeting["id"],
                "old_agenda_item_count": len(meeting["raw_data"].get("agenda_items") or []),
                "new_agenda_item_count": len(raw_items),
                "decisions_preview": decisions_preview,
            })

        for entry in plan:
            if entry["status"] == "skipped_no_existing_row":
                print(f"EventId {entry['event_id']}: SKIPPED -- no existing meetings row (never scraped).")
                continue
            print(f"EventId {entry['event_id']} -> meetings.id {entry['meeting_id']}: "
                  f"{entry['old_agenda_item_count']} -> {entry['new_agenda_item_count']} agenda_items, "
                  f"{len(entry['decisions_preview'])} decision-eligible item(s)")
            for d in entry["decisions_preview"]:
                print(f"    {d['agenda_number'] or '':>6}  {d['outcome']:<10}  {d['title']}")

        if args.dry_run:
            print("\n--dry-run: no raw_data written, no meeting_decisions written, no backup file created.")
            return 0

        to_apply = [e for e in plan if e["status"] == "will_enrich"]
        if not to_apply:
            print("\nNothing to apply.")
            return 0

        backup_entries = []
        with conn.cursor() as cur:
            for entry in to_apply:
                meeting = find_meeting_row(conn, entry["event_id"])
                backup_entries.append({
                    "event_id": entry["event_id"], "meeting_id": meeting["id"],
                    "old_raw_data": meeting["raw_data"],
                })
        backup_path = write_backup(backup_entries)
        print(f"\nBacked up old raw_data for {len(backup_entries)} meeting(s) to {backup_path}")

        new_count = updated_count = 0
        with conn.cursor() as cur:
            for entry in to_apply:
                meeting = find_meeting_row(conn, entry["event_id"])
                raw_items = fetch_event_items_with_votes(entry["event_id"])
                new_raw = build_new_raw_data(meeting["raw_data"], raw_items)
                cur.execute(
                    "UPDATE meetings SET raw_data = %s WHERE id = %s",
                    (json.dumps(new_raw, default=str), meeting["id"]),
                )
                items = dedupe_shadow_items(new_raw["agenda_items"])
                for item in items:
                    if not item.get("EventItemId") or not item.get("EventItemMatterId"):
                        continue
                    inserted = upsert_decision(conn, meeting["id"], meeting["raw_data"].get("EventAgendaFile"), item)
                    if inserted:
                        new_count += 1
                    else:
                        updated_count += 1

        print(f"Updated raw_data on {len(to_apply)} meeting(s); "
              f"meeting_decisions: {new_count} new, {updated_count} updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
