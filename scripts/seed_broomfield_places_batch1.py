"""Broomfield place-layer handoff, Step 3: the first 10 places, seeded
end-to-end by hand -- a data-entry job, not a scraper. Every fact below was
looked up live against the place's own real, named source (broomfield.org's
own pages, USPS's own location tool, RTD's own page) on 2026-09-13; where a
source didn't state a fact (most commonly: exact hours for a government
office lobby), the field is left NULL here rather than guessed. See
NEEDS-HUMAN-REVIEW.md for the full research notes, including the one place
DELIBERATELY NOT added despite being on the spec's own "coverage to aim for"
list: Adams 12 Five Star Schools' administration building is in Thornton,
CO, not Broomfield -- outside this directory's own established "in the
city, not just serving it" scope (see ingest_moval_facilities.py's own
identical convention).

day_of_week convention for place_hours: 0=Sunday, 1=Monday, ..., 6=Saturday
(JS Date.getDay() convention -- no existing precedent in this codebase's
day-numbering to follow, since hours_structured uses named JSONB keys, not
numeric days).

Run once: `python -m scripts.seed_broomfield_places_batch1`. Idempotent --
UPDATEs by (town_id, slug), and place_hours are deleted+reinserted for a
place before its new rows are added, so a re-run never duplicates hours
rows or clobbers a different place's data.
"""
from __future__ import annotations

from datetime import date

from db.db import get_conn, record_run

TOWN_ID = "broomfield_co"
TODAY = date.today().isoformat()

# --- Existing places, enriched with real place-layer facts -----------------
# hours: list of (day_of_week, opens, closes) tuples, or None if not
# confirmable from a real, current source (left NULL / no place_hours rows).
PLACE_UPDATES = [
    {
        "slug": "paul-derda-recreation-center",
        "source_url": "https://www.broomfield.org/2664/Paul-Derda-Recreation-Center",
        "hours": [
            (1, "05:00", "22:00"), (2, "05:00", "22:00"), (3, "05:00", "22:00"), (4, "05:00", "22:00"),
            (5, "05:00", "18:30"), (6, "07:00", "20:00"), (0, "08:00", "18:00"),
        ],
        "is_free": False,
        "fee_note": "Day passes and memberships required; see broomfield.org/364/Passes-and-Fees for current rates.",
        "services": ["pool", "gym", "fitness_center", "indoor_track", "childcare", "meeting_rooms"],
        "accessibility_note": None,
    },
    {
        "slug": "broomfield-community-center",
        "source_url": "https://www.broomfield.org/2708/Broomfield-Community-Center",
        "hours": [
            (1, "05:00", "22:00"), (2, "05:00", "22:00"), (3, "05:00", "22:00"), (4, "05:00", "22:00"),
            (5, "05:00", "20:00"), (6, "07:00", "20:00"), (0, "08:00", "18:00"),
        ],
        "is_free": False,
        "fee_note": "Day passes and memberships required; see broomfield.org/364/Passes-and-Fees for current rates.",
        "services": ["pool", "gym", "fitness_center", "meeting_rooms", "woodshop"],
        "accessibility_note": None,
    },
    {
        "slug": "library",
        "source_url": "https://www.broomfield.org/276/Library-Home",
        "hours": [
            (1, "09:00", "21:00"), (2, "09:00", "21:00"), (3, "09:00", "21:00"), (4, "09:00", "21:00"),
            (5, "09:00", "17:00"), (6, "09:00", "17:00"), (0, "13:00", "17:00"),
        ],
        "is_free": True,
        "fee_note": None,
        "services": ["wifi", "printing", "meeting_rooms"],
        "accessibility_note": None,
    },
    {
        "slug": "broomfield-recycling-center",
        "source_url": "https://www.broomfield.org/310/Recycling-Center",
        # Genuinely, confirmedly 24/7 self-serve drop-off -- not an
        # approximation like a "dawn to dusk" park would be.
        "hours": [(d, "00:00", "23:59") for d in range(7)],
        "is_free": True,
        "fee_note": None,
        "services": ["recycling_dropoff"],
        "accessibility_note": None,
    },
    {
        "slug": "broomfield-police-department",
        "source_url": "https://www.broomfield.org/POLICE",
        "hours": [(d, "08:00", "17:00") for d in range(1, 6)],  # Mon-Fri, lobby closed weekends (confirmed)
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
    },
    {
        "slug": "usps-broomfield",
        "source_url": "https://tools.usps.com/locations/details/1356062",
        "hours": [(d, "09:00", "16:00") for d in range(1, 6)] + [(6, "09:00", "12:00")],  # Sun closed (confirmed)
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
    },
    {
        "slug": "usps-broomfield-eagle-view",
        "source_url": "https://tools.usps.com/locations/details/1361605",
        "hours": [(d, "09:00", "16:00") for d in range(1, 6)] + [(6, "09:00", "12:00")],
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
    },
    {
        "slug": "county-commons-park",
        "source_url": "https://www.broomfield.org/106/Broomfield-County-Commons",
        "hours": None,  # not stated on the official page -- left unconfirmed, not guessed
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "sports_fields", "dog_park", "picnic_area", "restrooms"],
        "accessibility_note": None,
    },
    {
        "slug": "city-hall",
        "source_url": "https://www.broomfield.org/409/Contact",
        # Multiple current broomfield.org department pages (Benefits Team,
        # Police lobby) independently confirm Mon-Fri 8-5 as the standard
        # building pattern, but no current, dated source states THIS
        # building's own hours directly (the one document that does,
        # broomfield.org/DocumentCenter/View/4413, is dated "Revised
        # 5/1/2013" -- 13 years stale, not treated as current). Left
        # unconfirmed rather than inferred from a pattern.
        "hours": None,
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
    },
]

# --- One genuinely new place, filling a real coverage gap (no existing
# Broomfield place is category='transit') ----------------------------------
NEW_PLACE = {
    "slug": "us-36-broomfield-station",
    "name": "US 36 & Broomfield Station Park-n-Ride",
    "category": "transit",  # new category value -- label/schema-type mapping deferred to Step 4
    "address": "8010 Transit Way, Broomfield, CO",
    "phone": None,
    "website": "https://www.rtd-denver.com",
    "source_url": "https://www.broomfield.org/3288/Regional-Transportation-District-RTD",
    "is_free": True,  # free to access as a rider; parking payment is separate and not a fee to confirm here
    "fee_note": None,
    "services": ["bus", "bike_storage", "park_and_ride"],
    "accessibility_note": None,
    "hours": None,  # no explicit lot hours stated -- transit infrastructure, not assumed 24/7 without a direct statement
}


def apply_place_update(conn, update: dict) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE places
               SET source_url = %(source_url)s,
                   is_free = %(is_free)s,
                   fee_note = %(fee_note)s,
                   services = %(services)s,
                   accessibility_note = %(accessibility_note)s,
                   verification_method = 'manual',
                   hours_confidence = %(hours_confidence)s,
                   verified_date = %(today)s,
                   updated_at = now()
             WHERE town_id = %(town_id)s AND slug = %(slug)s
             RETURNING id
            """,
            {
                "source_url": update["source_url"], "is_free": update["is_free"],
                "fee_note": update["fee_note"], "services": update["services"],
                "accessibility_note": update["accessibility_note"],
                "hours_confidence": "structured" if update["hours"] else "unknown",
                "today": TODAY, "town_id": TOWN_ID, "slug": update["slug"],
            },
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(f"No existing place found for slug={update['slug']!r} -- seed_facilities.py hasn't run, or the slug changed")
        place_id = row[0]

        # Idempotent re-run: clear this place's own weekly hours before
        # reinserting, never touching any other place's rows.
        cur.execute("DELETE FROM place_hours WHERE place_id = %s", (place_id,))
        if update["hours"]:
            for day_of_week, opens, closes in update["hours"]:
                cur.execute(
                    "INSERT INTO place_hours (place_id, day_of_week, opens, closes) VALUES (%s, %s, %s, %s)",
                    (place_id, day_of_week, opens, closes),
                )
        return place_id


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
            ON CONFLICT (town_id, slug) DO UPDATE SET updated_at = now()
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
        for update in PLACE_UPDATES:
            place_id = apply_place_update(conn, update)
            # 'manual' means the verification itself succeeded (a real,
            # current source was checked) -- NOT that every fact was
            # confirmable. Whether hours specifically came back structured
            # or unknown is recorded on the places row's own
            # hours_confidence, not here; a source lacking a fact isn't a
            # failed run, and marking it 'error' would incorrectly pollute
            # consecutive_failures() for this source_key going forward.
            record_run(conn, TOWN_ID, f"place:{update['slug']}", "manual", items_found=1, items_new=0)
            print(f"  updated place_id={place_id} slug={update['slug']} hours_confidence={'structured' if update['hours'] else 'unknown'}")

        new_id = insert_new_place(conn, NEW_PLACE)
        record_run(conn, TOWN_ID, f"place:{NEW_PLACE['slug']}", "manual", items_found=1, items_new=1)
        print(f"  inserted place_id={new_id} slug={NEW_PLACE['slug']} (new)")


if __name__ == "__main__":
    main()
