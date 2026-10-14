"""One-time backfill, step 3a of the 2026-10-14 follow-up: for every Brookings
(Legistar) meeting on/after 2026-06-18 (this town's earliest scraped meeting
row -- see scripts/backfill_legistar_decisions_4_meetings.py) that already
has a meetings row, re-fetch eventitems+votes for any agenda item that still
has no real outcome signal (no EventItemPassedFlagName, no MatterStatus
'Filed', no EventItemActionName -- see
ai_pipeline.meeting_decisions_legistar.outcome_from_item's OUTCOME_PENDING
fallback) and merge any newly-posted result into that meeting's existing
raw_data + meeting_decisions. Same mechanism as
scripts/backfill_legistar_decisions_4_meetings.py, generalized from 4
hardcoded EventIds to "every in-scope meeting with a pending decision-eligible
item", per the owner's point 3a scope: "inga nya rader, inga nya stories,
ingen AI" -- this only UPDATEs meetings.raw_data on rows that already exist
and upserts meeting_decisions; it never INSERTs into meetings and never calls
ai_pipeline.publish or any AI step.

Usage:
    python -m scripts.backfill_legistar_outcomes_since_2026_06_18 --dry-run
    python -m scripts.backfill_legistar_outcomes_since_2026_06_18   # real run, writes a backup file first
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from db.db import get_conn
from scrapers.parsers.legistar_v1 import _items_to_text, MAX_AGENDA_TEXT_CHARS
from ai_pipeline.meeting_decisions_legistar import dedupe_shadow_items, outcome_from_item, upsert_decision, OUTCOME_PENDING
from scripts.backfill_legistar_decisions_4_meetings import fetch_event_items_with_votes, build_new_raw_data

TOWN_ID = "brookings_sd"
SINCE = "2026-06-18"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def find_candidate_meetings(conn) -> list[dict]:
    """Legistar-sourced meetings (raw_data has 'EventId') on/after SINCE that
    already carry agenda_items -- rows from other sources (e.g. the plain
    calendar/ICS feed mixed into this town's meetings table, which has no
    EventId/agenda_items at all) are excluded, since they were never
    Legistar-enriched in the first place."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, raw_data->>'EventId', meeting_date, raw_data "
            "FROM meetings WHERE town_id = %s AND meeting_date >= %s "
            "AND raw_data ? 'EventId' AND raw_data ? 'agenda_items' "
            "ORDER BY meeting_date",
            (TOWN_ID, SINCE),
        )
        rows = cur.fetchall()

    candidates = []
    for meeting_id, event_id, meeting_date, raw_data in rows:
        items = raw_data.get("agenda_items") or []
        pending = [
            it for it in items
            if it.get("EventItemMatterId") and outcome_from_item(it) == OUTCOME_PENDING
        ]
        if not pending:
            continue
        candidates.append({
            "meeting_id": meeting_id,
            "event_id": int(event_id),
            "meeting_date": meeting_date,
            "body": raw_data.get("EventBodyName"),
            "raw_data": raw_data,
            "pending_before": pending,
        })
    return candidates


def write_backup(entries: list[dict]) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"legistar_outcomes_since_2026-06-18_backfill_{stamp}.json"
    path.write_text(json.dumps(entries, indent=2, default=str), encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        candidates = find_candidate_meetings(conn)
        print(f"{len(candidates)} meeting(s) on/after {SINCE} with >=1 pending decision-eligible item:\n")

        plan = []
        for c in candidates:
            raw_items = fetch_event_items_with_votes(c["event_id"])
            items = dedupe_shadow_items(raw_items)
            resolved = []
            for before in c["pending_before"]:
                after = next((i for i in items if i.get("EventItemId") == before.get("EventItemId")), None)
                if after is not None and outcome_from_item(after) != OUTCOME_PENDING:
                    resolved.append({
                        "event_item_id": before.get("EventItemId"),
                        "agenda_number": before.get("EventItemAgendaNumber"),
                        "title": before.get("EventItemTitle"),
                        "new_outcome": outcome_from_item(after),
                    })
            print(f"meeting {c['meeting_id']} (EventId {c['event_id']}, {c['body']}, "
                  f"{c['meeting_date'].date()}): {len(c['pending_before'])} pending -> "
                  f"{len(resolved)} now resolved")
            for r in resolved:
                print(f"    {r['agenda_number'] or '':>6}  pending -> {r['new_outcome']:<10}  {r['title']}")
            plan.append({**c, "raw_items": raw_items, "resolved": resolved})

        actionable = [p for p in plan if p["resolved"]]
        print(f"\n{len(actionable)} of {len(plan)} candidate meeting(s) have a newly-posted result.")

        if args.dry_run:
            print("--dry-run: no raw_data written, no meeting_decisions written, no backup file created.")
            return 0

        if not actionable:
            print("Nothing to apply.")
            return 0

        backup_entries = [{"meeting_id": p["meeting_id"], "event_id": p["event_id"],
                            "old_raw_data": p["raw_data"]} for p in actionable]
        backup_path = write_backup(backup_entries)
        print(f"Backed up old raw_data for {len(backup_entries)} meeting(s) to {backup_path}")

        new_count = updated_count = 0
        with conn.cursor() as cur:
            for p in actionable:
                new_raw = build_new_raw_data(p["raw_data"], p["raw_items"])
                cur.execute(
                    "UPDATE meetings SET raw_data = %s WHERE id = %s",
                    (json.dumps(new_raw, default=str), p["meeting_id"]),
                )
                items = dedupe_shadow_items(new_raw["agenda_items"])
                for item in items:
                    if not item.get("EventItemId") or not item.get("EventItemMatterId"):
                        continue
                    inserted = upsert_decision(conn, p["meeting_id"], p["raw_data"].get("EventAgendaFile"), item)
                    if inserted:
                        new_count += 1
                    else:
                        updated_count += 1
        conn.commit()
        print(f"Updated raw_data on {len(actionable)} meeting(s); "
              f"meeting_decisions: {new_count} new, {updated_count} updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
