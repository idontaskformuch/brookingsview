"""Broomfield place-layer handoff, Step 5 (batch 1 of the remaining 30-50):
10 more places, same rules as scripts/seed_broomfield_places_batch1.py --
real data entry, every fact looked up live against the place's own current,
named source on 2026-09-13, NULL where a source doesn't state a fact.

Three real candidates were checked and DELIBERATELY NOT added -- same "in
the city, not just serving it" scope as batch1's own Adams 12 exclusion:
- Boulder Valley School District's administrative building is at 6500
  Arapahoe Rd, BOULDER, CO -- not Broomfield. Neither of the spec's own
  two named school districts has its admin office actually in Broomfield.
- McKay Lake Park is owned and operated by the City of Westminster, not
  Broomfield, despite appearing in "Broomfield parks" search results.
- Josh's Pond has no clean official street address or confirmed status as
  its own distinct facility record (vs. being a feature of the adjacent
  "Community Park" facility, id 14, which IS added below) -- left out
  rather than guessed at.

One real, live test of the exceptions feature: the Broomfield Depot
Museum is CURRENTLY closed for construction through September 2026
(confirmed on its own official page), reopening October 3. Two exception
rows cover the affected upcoming Saturdays (its only normal open day)
within the page's own 60-day upcoming-exceptions window.

day_of_week convention: 0=Sunday..6=Saturday (see batch1's own comment).
Run once: `python -m scripts.seed_broomfield_places_batch2`. Idempotent,
same pattern as batch1 (place_hours/exceptions deleted+reinserted per
place, matched by slug -- never touches another place's rows).
"""
from __future__ import annotations

from datetime import date

from db.db import get_conn, record_run

TOWN_ID = "broomfield_co"
TODAY = date.today().isoformat()

# New category values introduced this batch -- FACILITY_CATEGORY_LABELS/
# FACILITY_SCHEMA_TYPE need a 'museum' entry added in lib/db.ts before the
# next Astro build (same "add the label when the first real row needs it"
# convention as Step 3's own 'transit' addition).
NEW_PLACES = [
    {
        "slug": "the-bay-aquatic-park",
        "name": "The Bay Aquatic Park",
        "category": "community_center",
        "address": "250 Spader Way, Broomfield, CO 80020",
        "phone": "303-464-5520",
        "website": "https://www.broomfield.org/2651/The-Bay-Aquatic-Park",
        "source_url": "https://www.broomfield.org/2651/The-Bay-Aquatic-Park",
        "is_free": False,
        "fee_note": "Session tickets required; ages 3 and under free with a paying adult. See the facility's own page for current session pricing.",
        "services": ["pool", "water_slides", "sprayground", "concessions"],
        "accessibility_note": None,
        # Seasonal (May 23 - Sept 7, 2026 this year) with session-based
        # hours that vary by a separate schedule document -- not cleanly
        # expressible as a simple weekly table without guessing. Left
        # unconfirmed rather than approximated; it's also currently out of
        # season regardless.
        "hours": None,
    },
    {
        "slug": "us-36-flatiron-station",
        "name": "US 36 & Flatiron Station Park-n-Ride",
        "category": "transit",
        "address": "398 East Flatiron Circle, Broomfield, CO",
        "phone": None,
        "website": "https://www.rtd-denver.com",
        "source_url": "https://www.broomfield.org/3288/Regional-Transportation-District-RTD",
        "is_free": True,
        "fee_note": None,
        "services": ["bus", "bike_storage", "park_and_ride"],
        "accessibility_note": None,
        "hours": None,  # no explicit lot-hours statement, same as the first RTD station
    },
    {
        "slug": "miramonte-park",
        "name": "Miramonte Park",
        "category": "park",
        "address": "Daphne Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://broomfield.org/Facilities/Facility/Details/37",
        "source_url": "https://broomfield.org/Facilities/Facility/Details/37",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "basketball_court", "picnic_area", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "zang-spur-park",
        "name": "Zang Spur Park",
        "category": "park",
        "address": "West 10th Avenue and Depot Hill Road, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/facilities/facility/details/Zang-Spur-Park-3",
        "source_url": "https://www.broomfield.org/facilities/facility/details/Zang-Spur-Park-3",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "basketball_court", "tennis_court", "softball_field", "sand_volleyball", "trails", "restrooms"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "community-park",
        "name": "Community Park",
        "category": "park",
        "address": "Second Avenue and Main Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/14",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/14",
        "is_free": True,
        "fee_note": None,
        "services": ["pool", "playground", "skate_park", "tennis_court", "softball_field", "amphitheater", "restrooms", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "broomfield-depot-museum",
        "name": "Broomfield Depot Museum",
        "category": "museum",
        "address": "2201 W. 10th Ave, Broomfield, CO 80020",
        "phone": "303-460-6824",
        "website": "https://www.broomfield.org/3515/Broomfield-Depot-Museum",
        "source_url": "https://www.broomfield.org/3515/Broomfield-Depot-Museum",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        "hours": [(6, "11:00", "16:00")],  # Saturdays 11am-4pm ("most Saturdays" -- see exceptions below)
        "exceptions": [
            # Currently closed for construction through September 2026,
            # reopening October 3 -- confirmed live on the museum's own
            # page. Only the upcoming Saturdays within the closure window
            # get a row (past Saturdays have no reader value).
            ("2026-09-19", None, None, "Closed for construction (reopens October 3, 2026)"),
            ("2026-09-26", None, None, "Closed for construction (reopens October 3, 2026)"),
        ],
    },
    {
        "slug": "broomfield-health-human-services",
        "name": "Broomfield Health and Human Services",
        "category": "other",
        "address": "100 Spader Way, Broomfield, CO 80020",
        "phone": "720-887-2200",
        "website": "https://www.broomfield.org/260/Human-Services",
        "source_url": "https://www.broomfield.org/260/Human-Services",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        "hours": [(d, "08:00", "17:00") for d in range(1, 6)],  # Mon-Fri 8-5, confirmed directly on the dept's own page
    },
    {
        "slug": "broomfield-workforce-center",
        "name": "Broomfield Workforce Center",
        "category": "other",
        "address": "100 Spader Way, Broomfield, CO 80020",
        "phone": "303-464-5855",
        "website": "https://www.broomfield.org/2963/Workforce-Center",
        "source_url": "https://www.broomfield.org/2963/Workforce-Center",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        # Real split hours -- closed for lunch noon-1pm, confirmed on the
        # center's own page. Same building as Health and Human Services
        # above, but a distinct service with its own phone and hours.
        "hours": [(d, "08:00", "12:00") for d in range(1, 6)] + [(d, "13:00", "17:00") for d in range(1, 6)],
    },
    {
        "slug": "broomfield-veterans-museum",
        "name": "Broomfield Veterans Museum",
        "category": "museum",
        "address": "12 Garden Center, Broomfield, CO 80020",
        "phone": "303-460-6801",
        "website": "https://broomfieldveterans.org/",
        "source_url": "https://broomfieldveterans.org/about/hours/",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        "hours": [(2, "10:00", "14:00"), (4, "10:00", "14:00"), (6, "09:00", "15:00")],  # Tue, Thu 10-2; Sat 9-3
    },
    {
        "slug": "broomfield-auditorium",
        "name": "Broomfield Auditorium",
        "category": "other",
        "address": "3 Community Park Road, Broomfield, CO 80020",
        "phone": "720-887-2371",
        "website": "https://www.broomfield.org/243/Rent-the-Auditorium",
        "source_url": "https://www.broomfield.org/243/Rent-the-Auditorium",
        "is_free": None,  # a rental venue, not a "free to enter" civic space -- doesn't map cleanly to true/false
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        # Only the confirmed regular weekday office hours -- weekend hours
        # "vary per event" per the source, not a fixed schedule, so no
        # Saturday/Sunday rows (absence = unknown, not "closed").
        "hours": [(d, "10:00", "18:00") for d in range(1, 6)],
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

        cur.execute("DELETE FROM place_hours_exceptions WHERE place_id = %s", (place_id,))
        for exc_date, opens, closes, reason in place.get("exceptions", []):
            cur.execute(
                """
                INSERT INTO place_hours_exceptions
                    (place_id, date, opens, closes, reason, source_url, last_verified_at)
                VALUES (%s, %s, %s, %s, %s, %s, now())
                """,
                (place_id, exc_date, opens, closes, reason, place["source_url"]),
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
