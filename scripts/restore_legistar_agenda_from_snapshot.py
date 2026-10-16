"""One-off recovery for the Legistar raw_data-overwrite bug fixed in
db.upsert_records()'s new merge_raw_data param (see that function's own
doc comment, and legistar_v1.py's own merge_raw_data=True): that fix
stops FUTURE data loss, but 9 brookings_sd meetings already lost their
real agenda_items/agenda_text before it shipped, when Legistar started
answering empty eventitems for an event old enough (confirmed live,
51-58 days) and the old blind `raw_data = EXCLUDED.raw_data` replace
erased the richer historical content.

For every meetings row currently missing raw_data.agenda_items, searches
source_snapshots' own city_meetings history (by EventId) for the LAST
snapshot where that event's agenda items were non-empty, and restores
them -- as a MERGE into the current raw_data (jsonb `||`, new row wins
on any other key), never a wholesale revert to the old snapshot, so any
field that's genuinely newer today (e.g. minutes_url) is kept. Items are
re-cleaned/re-flattened via legistar_v1.py's own _clean_item()/
_items_to_text() so the restored shape is byte-identical to what a
normal scrape would have produced, not a second, hand-rolled format.

A meeting with NO snapshot ever showing real items -- either it
genuinely never had any, or the loss predates the snapshot archive's
own window (confirmed for 3 of the 28 original quorum-notice candidates,
all June 2026 meetings, older than this archive's earliest snapshot) --
is reported and never touched. Never guessed at.

Usage:
    python -m scripts.restore_legistar_agenda_from_snapshot --dry-run
    python -m scripts.restore_legistar_agenda_from_snapshot
"""
from __future__ import annotations

import argparse
import json

from psycopg.rows import dict_row

from scrapers.parsers.legistar_v1 import MAX_AGENDA_TEXT_CHARS, _clean_item, _items_to_text
from db.db import get_conn

TOWN_ID = "brookings_sd"


def find_candidates(conn) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, body, meeting_date, raw_data->>'EventId' AS event_id
              FROM meetings
             WHERE town_id = %s AND raw_data ? 'EventId' AND NOT (raw_data ? 'agenda_items')
             ORDER BY meeting_date
            """,
            (TOWN_ID,),
        )
        return cur.fetchall()


def last_known_good_agenda(conn, event_id: str) -> dict | None:
    """Scans city_meetings snapshots OLDEST to NEWEST, keeping the last
    one where this EventId had non-empty _agenda_items. Returns
    {"agenda_items": [...], "agenda_text": "...", "fetched_at": ...} or
    None if no snapshot ever had any."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, fetched_at, raw FROM source_snapshots
             WHERE town_id = %s AND source_key = 'city_meetings'
             ORDER BY fetched_at
            """,
            (TOWN_ID,),
        )
        snapshots = cur.fetchall()

    best = None
    for snap in snapshots:
        try:
            events = json.loads(bytes(snap["raw"]).decode("utf-8"))
        except Exception:
            continue
        for e in events:
            if str(e.get("EventId")) != event_id:
                continue
            raw_items = e.get("_agenda_items") or []
            if raw_items:
                best = {"raw_items": raw_items, "fetched_at": snap["fetched_at"]}
            break
    if best is None:
        return None
    cleaned = [_clean_item(i) for i in best["raw_items"]]
    agenda_text = _items_to_text(best["raw_items"])
    return {
        "agenda_items": cleaned,
        "agenda_text": agenda_text[:MAX_AGENDA_TEXT_CHARS] if agenda_text else None,
        "fetched_at": best["fetched_at"],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        candidates = find_candidates(conn)
        print(f"\n=== Legistar agenda restore: {len(candidates)} candidate meeting(s) ===")

        restorable = []
        unrecoverable = []
        for row in candidates:
            found = last_known_good_agenda(conn, row["event_id"])
            if found is None:
                unrecoverable.append(row)
            else:
                restorable.append({**row, **found})

        print(f"\n{len(restorable)} restorable (a snapshot with real items found):")
        for r in restorable:
            print(f"  meeting {r['id']} ({r['body']}, {r['meeting_date']}):")
            print(f"    restoring {len(r['agenda_items'])} agenda item(s) last seen in a snapshot "
                  f"fetched {r['fetched_at']}")
            print(f"    agenda_text preview: {(r['agenda_text'] or '')[:120]!r}...")

        print(f"\n{len(unrecoverable)} unrecoverable (no snapshot ever had real items for this EventId) "
              f"-- NEVER touched:")
        for r in unrecoverable:
            print(f"  meeting {r['id']} ({r['body']}, {r['meeting_date']}) -- EventId {r['event_id']}")

        if args.dry_run:
            print(f"\n(dry-run -- {len(restorable)} row(s) would be updated, nothing changed)")
            return 0

        if restorable:
            with conn.cursor() as cur:
                for r in restorable:
                    patch = {"agenda_items": r["agenda_items"]}
                    if r["agenda_text"]:
                        patch["agenda_text"] = r["agenda_text"]
                    cur.execute(
                        "UPDATE meetings SET raw_data = raw_data || %s::jsonb WHERE id = %s",
                        (json.dumps(patch, default=str), r["id"]),
                    )
            conn.commit()
        print(f"\nRestored {len(restorable)} row(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
