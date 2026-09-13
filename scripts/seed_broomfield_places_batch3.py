"""Broomfield place-layer handoff, Step 5 (batch 2 of the remaining 30-50):
9 more places, same rules as batch1/batch2 -- real data entry, every fact
looked up live against the place's own current, named source on
2026-09-13, NULL where a source doesn't state a fact.

Two real candidates were checked and found to be the SAME BUILDING as an
already-seeded place, not new places -- documented here rather than added
as duplicates:
- Broomfield Animal Services (broomfield.org/297/Animal-Services) is at
  7 DesCombes Dr -- the exact same address as the already-seeded
  broomfield-police-department. It's a division of the police department,
  not a separate facility.
- The Broomfield Motor Vehicle / Clerk and Recorder office
  (broomfield.org/284/Motor-Vehicle) is at One DesCombes Drive -- the
  exact same address as the already-seeded city-hall (the George Di Ciero
  City and County Building). A department inside city hall, not a
  separate building.

One real fact left deliberately unconfirmed despite being a near-universal
default for US hospitals: uchealth.org itself returns HTTP 403 to
automated fetches (confirmed twice, two different pages under that
domain), so UCHealth Broomfield Hospital's ER 24/7 status could not be
verified against its own primary source in this sitting. Search-engine
result summaries referencing that page's text were NOT treated as a
substitute for a directly-fetched, verifiable source, per this project's
own "no AI-generated hours, ever" rule -- hours_confidence is 'unknown'
for this place, not 'structured', even though a hospital ER being open
24/7 is almost certainly true. Address and phone WERE independently
confirmed (cumedicine.us's own official CU Medicine location page,
directly fetched, consistent with every other reference found).

One live catch from directly fetching rather than trusting a search
summary: a search summary for the skate park's hours/address ("150 Lamar
Street", "8 AM to 10 PM") did NOT match what broomfield.org's own page
actually says ("150 Spader Way", "6 a.m. - 10 p.m.") once fetched
directly -- the version below uses the directly-fetched, correct values.
This is exactly the failure mode the "official sources first, verify
directly" rule exists to catch.

day_of_week convention: 0=Sunday..6=Saturday (see batch1's own comment).
Run once: `python -m scripts.seed_broomfield_places_batch3`. Idempotent,
same pattern as batch1/batch2 (place_hours/exceptions deleted+reinserted
per place, matched by slug -- never touches another place's rows).
"""
from __future__ import annotations

from datetime import date

from db.db import get_conn, record_run

TOWN_ID = "broomfield_co"
TODAY = date.today().isoformat()

NEW_PLACES = [
    {
        "slug": "broomfield-court-services",
        "name": "Broomfield Combined Court & Municipal Court",
        "category": "other",
        "address": "17 DesCombes Drive, Broomfield, CO 80020",
        "phone": "720-887-2100",
        "website": "https://www.broomfield.org/233/Court-Services",
        "source_url": "https://www.broomfield.org/233/Court-Services",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        # Confirmed directly on the dept's own page: Mon-Fri 7:30-4:30,
        # closed for lunch 11:30-12:30 -- a real split-hours case.
        "hours": [(d, "07:30", "11:30") for d in range(1, 6)] + [(d, "12:30", "16:30") for d in range(1, 6)],
    },
    {
        "slug": "uchealth-broomfield-hospital",
        "name": "UCHealth Broomfield Hospital",
        "category": "medical",
        "address": "11820 Destination Dr, Broomfield, CO 80021",
        "phone": "303-464-4500",
        "website": "https://www.uchealth.org/locations/uchealth-broomfield-hospital/",
        "source_url": "https://www.cumedicine.us/location-appointment/UCHealth-Broomfield-Hospital",
        "is_free": None,  # a hospital, not a "free to enter" civic space -- doesn't map cleanly to true/false
        "fee_note": None,
        "services": ["emergency_room"],
        "accessibility_note": None,
        # Left unconfirmed -- see module docstring: uchealth.org itself
        # 403s automated fetches, so the near-universal "ER open 24/7"
        # fact was NOT independently verified against its own primary
        # source in this sitting, only against search-summary text.
        "hours": None,
    },
    {
        "slug": "anthem-community-park",
        "name": "Anthem Community Park",
        "category": "park",
        "address": "15663 Sheridan Pkwy, Broomfield, CO 80021",
        "phone": "303-464-5501",
        "website": "https://www.broomfield.org/Facilities/Facility/Details/47",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/47",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "soccer_field", "tennis_court", "picnic_area", "restrooms", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "northmoor-park",
        "name": "Northmoor Park",
        "category": "park",
        "address": "13th Avenue and Birch Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/26",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/26",
        "is_free": True,
        "fee_note": None,
        "services": ["soccer_field", "basketball_court", "tennis_court", "picnic_area"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "lac-amora-park",
        "name": "Lac Amora Park",
        "category": "park",
        "address": "West 10th Avenue and Oak Circle North, Broomfield, CO 80021",
        "phone": None,
        "website": "https://broomfield.org/Facilities.aspx?Page=detail&RID=25",
        "source_url": "https://broomfield.org/Facilities.aspx?Page=detail&RID=25",
        "is_free": True,
        "fee_note": None,
        "services": ["ballfield"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "broomfield-skate-park",
        "name": "Broomfield Skate Park",
        "category": "park",
        "address": "150 Spader Way, Broomfield, CO 80020",
        "phone": None,
        "website": "https://www.broomfield.org/4173/Skate-Park",
        "source_url": "https://www.broomfield.org/4173/Skate-Park",
        "is_free": True,
        "fee_note": "Free, use at your own risk (per the facility's own page).",
        "services": ["skate_park"],
        "accessibility_note": None,
        # Confirmed directly on the dept's own page: 6 a.m.-10 p.m. daily,
        # same hours stated for both listed seasonal ranges (Mar-Oct and
        # Nov-Feb), so a single flat daily window rather than two
        # valid_from/valid_to rows -- the source itself doesn't actually
        # vary the times, only restates them per season.
        "hours": [(d, "06:00", "22:00") for d in range(7)],
    },
    {
        "slug": "interlocken-east-park",
        "name": "Interlocken East Park",
        "category": "park",
        "address": "Interlocken Parkway and Interlocken Boulevard, Broomfield, CO 80020",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/21",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/21",
        "is_free": True,
        "fee_note": None,
        "services": ["disc_golf", "sand_volleyball", "picnic_area", "restrooms", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "broadlands-east-park",
        "name": "Broadlands East Park",
        "category": "park",
        "address": "Shannon Drive and Broadlands Drive, Broomfield, CO 80020",
        "phone": "303-902-2078",
        "website": "https://www.broomfield.org/facilities/facility/details/Broadlands-East-Park-43",
        "source_url": "https://www.broomfield.org/facilities/facility/details/Broadlands-East-Park-43",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "willow-park",
        "name": "Willow Park",
        "category": "park",
        "address": "Midway Boulevard and Vrain Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://broomfield.org/facilities/facility/details/Willow-Park-6",
        "source_url": "https://broomfield.org/facilities/facility/details/Willow-Park-6",
        "is_free": True,
        "fee_note": None,
        "services": ["soccer_field", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
]


def insert_new_place(conn, place: dict) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO places
                (town_id, slug, name, category, address, phone, website, source_url,
                 is_free, fee_note, services, accessibility_note, verification_method,
                 hours_confidence, verified_date, aliases, name_aliases, content_hash, updated_at)
            VALUES
                (%(town_id)s, %(slug)s, %(name)s, %(category)s, %(address)s, %(phone)s, %(website)s,
                 %(source_url)s, %(is_free)s, %(fee_note)s, %(services)s, %(accessibility_note)s,
                 'manual', %(hours_confidence)s, %(today)s, '{}', '{}',
                 %(content_hash)s, now())
            ON CONFLICT (town_id, slug) DO UPDATE SET
                source_url = EXCLUDED.source_url, is_free = EXCLUDED.is_free,
                fee_note = EXCLUDED.fee_note, services = EXCLUDED.services,
                accessibility_note = EXCLUDED.accessibility_note,
                hours_confidence = EXCLUDED.hours_confidence, verified_date = EXCLUDED.verified_date,
                updated_at = now()
            RETURNING id
            """,
            {
                "town_id": TOWN_ID, "slug": place["slug"], "name": place["name"],
                "category": place["category"], "address": place["address"], "phone": place["phone"],
                "website": place["website"], "source_url": place["source_url"],
                "is_free": place["is_free"], "fee_note": place["fee_note"],
                "services": place["services"], "accessibility_note": place["accessibility_note"],
                "hours_confidence": "structured" if place["hours"] else "unknown",
                "today": TODAY,
                "content_hash": f"place-manual-{place['slug']}",
            },
        )
        place_id = cur.fetchone()[0]

        cur.execute("DELETE FROM place_hours WHERE place_id = %s", (place_id,))
        if place["hours"]:
            for day_of_week, opens, closes in place["hours"]:
                cur.execute(
                    "INSERT INTO place_hours (place_id, day_of_week, opens, closes) VALUES (%s, %s, %s, %s)",
                    (place_id, day_of_week, opens, closes),
                )
        return place_id


def main() -> None:
    with get_conn() as conn:
        for place in NEW_PLACES:
            place_id = insert_new_place(conn, place)
            record_run(conn, TOWN_ID, f"place:{place['slug']}", "manual", items_found=1, items_new=1)
            print(f"  inserted/updated place_id={place_id} slug={place['slug']} hours_confidence={'structured' if place['hours'] else 'unknown'}")


if __name__ == "__main__":
    main()
