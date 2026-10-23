"""Make hours_structured and the place_hours rows agree with a place's (human-verified) hours_text.

Found 2026-10-23 (Q3): Brookings city-hall and public-library had a corrected hours_text (2026-10-15) while hours_structured and
the place_hours rows -- which the facility page's table and open/closed badge read -- still held the old wrong times, so the page
contradicted its own first paragraph. hours_text is the source of truth; this derives the other two from it with the same parser
(ai_pipeline/facility_hours.parse_hours_text) the original migration used.

    python -m scripts.sync_place_hours_from_text brookings_sd/city-hall            # dry run: prints what would change
    python -m scripts.sync_place_hours_from_text brookings_sd/city-hall --apply    # LIVE-DB write: needs the owner's yes (CLAUDE.md rule 7)

`python -m scripts.check_hours_consistency` lists every place whose three representations disagree (read-only).
"""
from __future__ import annotations

import argparse
import json

from ai_pipeline.facility_hours import parse_hours_text
from db.db import get_conn

DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("places", nargs="+", help="town_id/slug, e.g. brookings_sd/city-hall")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    with get_conn() as conn, conn.cursor() as cur:
        for ref in args.places:
            town, slug = ref.split("/", 1)
            cur.execute("SELECT id, hours_text FROM places WHERE town_id = %s AND slug = %s", (town, slug))
            row = cur.fetchone()
            if not row:
                print(f"[skip] {ref}: no such place")
                continue
            pid, text = row
            parsed = parse_hours_text(text)
            if parsed.structured is None:
                print(f"[skip] {ref}: hours_text {text!r} does not parse ({parsed.reason})")
                continue
            print(f"[{'apply' if args.apply else 'dry-run'}] {ref}: {text!r}")
            for i, day in enumerate(DAYS):
                w = parsed.structured.get(day)
                print(f"    {day:<9} {'closed' if not w else f'{w[0]}-{w[1]}'}")
            if args.apply:
                cur.execute("UPDATE places SET hours_structured = %s, hours_needs_review = false WHERE id = %s",
                            (json.dumps({d: (list(parsed.structured[d]) if parsed.structured.get(d) else None) for d in DAYS}), pid))
                cur.execute("DELETE FROM place_hours WHERE place_id = %s", (pid,))
                for i, day in enumerate(DAYS):
                    w = parsed.structured.get(day)
                    cur.execute("INSERT INTO place_hours (place_id, day_of_week, opens, closes) VALUES (%s, %s, %s, %s)",
                                (pid, i, w[0] if w else None, w[1] if w else None))
    if not args.apply:
        print("\nDRY RUN -- nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
