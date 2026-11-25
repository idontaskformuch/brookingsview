"""Owner order D 5 (2026-11-25): two Moreno Valley hours conflicts, settled the way the owner decided.

  * animal-shelter: the shelter's own page has two sets of times; the block under "Hours" is the one shown, as the source's text,
    with no open/closed pill (hours_text only: no hours_structured, no place_hours rows).
  * celebration-park: its hours_text ("Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward") reads as the splash pad's, not the park's.
    It moves to the park's visit note, and the park gets the city park rule (site/src/config/park-hours.ts, 7 am - 10 pm).

    python -m scripts.order_d_conflicts                    # dry run: prints the rows and the UPDATEs
    python -m scripts.prod_backup order_d_conflicts "SELECT id, town_id, slug, hours_text, hours_structured, hours_needs_review, visit_notes, source_url, verified_date, verification_method FROM places WHERE town_id = 'moreno_valley_ca' AND slug IN ('animal-shelter', 'celebration-park')"
    ALLOW_PROD_WRITE=order_d_conflicts python -m scripts.order_d_conflicts --apply --prod   # LIVE DB: only after the owner's own yes
"""
from __future__ import annotations

import argparse
from datetime import date

from db.db import declare_action, get_conn

declare_action("order_d_conflicts")

SHELTER_URL = "https://moval.org/resident_services/animal/index-animal.html"
# Verbatim from SHELTER_URL's "Hours" block (read 2026-11-25), line breaks joined.
SHELTER_TEXT = "Tues - Fri: 9:30 am – 6 pm. Sat: 10 am – 4 pm. Closed: Monday, Sunday & City Holidays."
CELEBRATION_OLD_TEXT = "Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward"
CELEBRATION_NOTE = f"Splash pad hours: {CELEBRATION_OLD_TEXT}."

UPDATES = [
    ("animal-shelter",
     "UPDATE places SET hours_text = %s, hours_structured = NULL, hours_needs_review = false, source_url = %s, "
     "verified_date = %s, verification_method = 'manual' WHERE town_id = 'moreno_valley_ca' AND slug = 'animal-shelter'",
     lambda today: (SHELTER_TEXT, SHELTER_URL, today)),
    ("celebration-park",
     "UPDATE places SET visit_notes = %s, hours_text = NULL, hours_structured = NULL, hours_needs_review = false "
     "WHERE town_id = 'moreno_valley_ca' AND slug = 'celebration-park' AND hours_text = %s",
     lambda today: (CELEBRATION_NOTE, CELEBRATION_OLD_TEXT)),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    today = date.today()
    with get_conn() as conn, conn.cursor() as cur:
        for slug, sql, params in UPDATES:
            cur.execute("SELECT hours_text, hours_structured IS NOT NULL, visit_notes, "
                        "(SELECT count(*) FROM place_hours ph WHERE ph.place_id = p.id) FROM places p "
                        "WHERE town_id = 'moreno_valley_ca' AND slug = %s", (slug,))
            print(f"{slug} now: {cur.fetchone()}")
            print(f"    {sql}\n    params: {params(today)}")
            if args.apply:
                cur.execute(sql, params(today))
                print(f"    updated {cur.rowcount} row(s)")
                cur.execute("DELETE FROM place_hours WHERE place_id = (SELECT id FROM places WHERE town_id = 'moreno_valley_ca' "
                            "AND slug = %s)", (slug,))
    if not args.apply:
        print("\nDRY RUN -- nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
