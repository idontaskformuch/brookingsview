"""Duplicate-meeting-candidate detector for Legistar-sourced meetings.

Round 5's duplicate query grouped meetings by (town, body, calendar day)
alone and reported 10 "duplicate" groups for Brookings -- disproven live
2026-10-14 (see .claude/state.md): every one of those turned out to be a
genuinely distinct event that happens to share a body and calendar day
with that body's regular meeting (overwhelmingly Legistar "Notice of
Quorum" postings -- SDCL 1-25-1.1 -- plus a couple of joint City/County
sessions), confirmed by checking each pair's own EventId/EventTime/
EventLocation, all of which differed within every pair. Grouping by
(body, day) alone can't tell a real re-posted duplicate from two unrelated
events that happen to land on the same calendar date for the same body.

This replaces that heuristic: a (body, day) group is only reported as a
LIKELY TRUE duplicate when two or more of its members also share the same
EventTime AND EventLocation -- the exact signal that disproved all 10
Brookings pairs (none of them matched on either field). Everything else in
a (body, day) group is reported separately as "not a duplicate" and is
never a candidate for marking superseded_by_slug.

Report-only: never writes to the database, never marks anything. Usage:
    python -m scripts.find_duplicate_meetings brookings_sd
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from typing import Any

from db.db import get_conn

TOWNS = ("brookings_sd", "moreno_valley_ca", "broomfield_co")


def _raw(raw_data: Any) -> dict:
    if isinstance(raw_data, str):
        raw_data = json.loads(raw_data)
    return raw_data or {}


def find_duplicate_candidates(rows: list[dict]) -> dict[str, list[dict]]:
    """rows: [{"id", "body", "meeting_date", "raw_data"}, ...] for ONE town.

    Returns {"true_duplicates": [...], "not_duplicates": [...]} -- the
    latter covers both "distinct EventTime/EventLocation" (a confirmed
    false positive) and "missing EventTime/EventLocation" (can't confirm
    OR rule out, needs a human look, never auto-flagged as a duplicate)."""
    by_day: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        by_day[(row["body"], row["meeting_date"].date())].append(row)

    true_duplicates = []
    not_duplicates = []
    for (body, day), candidates in by_day.items():
        if len(candidates) < 2:
            continue

        by_signature: dict[tuple, list[dict]] = defaultdict(list)
        for c in candidates:
            raw = _raw(c["raw_data"])
            by_signature[(raw.get("EventTime"), raw.get("EventLocation"))].append(c)

        for (event_time, event_location), group in by_signature.items():
            entry = {
                "body": body, "day": day.isoformat(),
                "event_time": event_time, "event_location": event_location,
                "meeting_ids": [g["id"] for g in group],
                "event_ids": [_raw(g["raw_data"]).get("EventId") for g in group],
            }
            if len(group) > 1 and event_time and event_location:
                true_duplicates.append(entry)
            elif len(group) > 1:
                entry["reason"] = "missing EventTime/EventLocation -- can't confirm or rule out"
                not_duplicates.append(entry)
            else:
                entry["reason"] = "distinct EventTime/EventLocation from the other same-day meeting(s)"
                not_duplicates.append(entry)

    return {"true_duplicates": true_duplicates, "not_duplicates": not_duplicates}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("town_id", choices=TOWNS)
    args = ap.parse_args()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, body, meeting_date, raw_data FROM meetings WHERE town_id = %s AND body IS NOT NULL",
                (args.town_id,),
            )
            rows = [{"id": r[0], "body": r[1], "meeting_date": r[2], "raw_data": r[3]} for r in cur.fetchall()]

    result = find_duplicate_candidates(rows)
    print(f"{args.town_id}: {len(result['true_duplicates'])} likely true duplicate group(s), "
          f"{len(result['not_duplicates'])} same-day non-duplicate entrie(s)")
    for g in result["true_duplicates"]:
        print(f"  TRUE DUPLICATE: {g['body']!r} on {g['day']} -- meetings {g['meeting_ids']} "
              f"(EventIds {g['event_ids']}) share EventTime={g['event_time']!r} "
              f"EventLocation={g['event_location']!r}")
    for g in result["not_duplicates"]:
        print(f"  not a duplicate: {g['body']!r} on {g['day']} -- meeting(s) {g['meeting_ids']} "
              f"(EventId(s) {g['event_ids']}) -- {g['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
