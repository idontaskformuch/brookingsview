"""Broomfield place-layer handoff, Step 5 (batch 3 of the remaining
30-50): 10 more places, same rules as batches 1-3 -- real data entry,
every fact looked up live against the place's own current, named source
on 2026-09-13, NULL where a source doesn't state a fact.

All ten are neighborhood parks this round -- the remaining un-added
categories (animal_shelter, school_district) have no real candidate
physically located in Broomfield that isn't already the same building as
an existing place (see batch3's own docstring for Animal Services/Motor
Vehicle) or outside city limits (see batch1/batch2 for the two school
district admin buildings), so parks are where real, addressable coverage
gaps remain.

One real candidate checked and DELIBERATELY NOT added: Interlocken West
Park. Its own official broomfield.org page gives its location as
"Interlocken Pkwy. & Interlocken Blvd., Broomfield, CO 80021" -- the same
cross-streets already used for the already-seeded Interlocken East Park
(batch3), differing only in a zip code that doesn't resolve the
ambiguity. Adding it would put two places on the site with
indistinguishable address text, which is worse than not adding it at
all. Left out rather than guessed at with a more "precise" address that
isn't what the source actually states.

Two more real catches from directly fetching each park's own official
page rather than trusting a search-engine summary (same discipline as
batch3's skate-park catch): a search summary for Midway Park stated "1280
W Midway Blvd, Broomfield, CO 80020"; broomfield.org's own facility page
states only "Midway Boulevard and Kohl Street, Broomfield, CO 80021" --
a different zip and no street number at all. A search summary for
Columbine Meadows Park stated it's "open from 5:00 AM to 11:00 PM";
broomfield.org's own facility page states no hours whatsoever. Both used
below reflect the directly-fetched, official text, not the search
summary.

day_of_week convention: 0=Sunday..6=Saturday (see batch1's own comment).
Run once: `python -m scripts.seed_broomfield_places_batch4`. Idempotent,
same pattern as batches 1-3 (place_hours deleted+reinserted per place,
matched by slug -- never touches another place's rows).
"""
from __future__ import annotations

from datetime import date

from db.db import get_conn, record_run

TOWN_ID = "broomfield_co"
TODAY = date.today().isoformat()

NEW_PLACES = [
    {
        "slug": "brandywine-parks",
        "name": "Brandywine Parks",
        "category": "park",
        "address": "Fern Avenue and Perry Street, Broomfield, CO 80020",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/7",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/7",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "bronco-park",
        "name": "Bronco Park",
        "category": "park",
        "address": "3100 Westlake Dr, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/11",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/11",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "country-vista-park",
        "name": "Country Vista Park",
        "category": "park",
        "address": "123rd Place and Sheridan Boulevard, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/17",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/17",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "soccer_field", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "greenway-park",
        "name": "Greenway Park",
        "category": "park",
        # Not to be confused with the separate, privately-run "Greenway
        # Park Golf Course" (110 Greenway Dr) that search results surface
        # under a near-identical name -- this is the city's own
        # neighborhood park facility, confirmed directly against
        # broomfield.org's own facility record for THIS id.
        "address": "Greenway East Drive and Ponderosa Place, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/20",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/20",
        "is_free": True,
        "fee_note": None,
        "services": ["baseball_field", "soccer_field", "playground", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "highland-park",
        "name": "Highland Park",
        "category": "park",
        "address": "Highland Park Drive and Kirkwall Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/facilities/facility/details/highlandpark-23",
        "source_url": "https://www.broomfield.org/facilities/facility/details/highlandpark-23",
        "is_free": True,
        "fee_note": None,
        "services": ["soccer_field", "restrooms"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "broadlands-west-park",
        "name": "Broadlands West Park",
        "category": "park",
        "address": "Meadow Mountain Road and Sheridan Boulevard, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/facilities.aspx?RID=8&Page=detail",
        "source_url": "https://www.broomfield.org/facilities.aspx?RID=8&Page=detail",
        "is_free": True,
        "fee_note": None,
        "services": None,
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "quail-creek-park",
        "name": "Quail Creek Park",
        "category": "park",
        "address": "138th Avenue and Zuni Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/29",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/29",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "restrooms"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "westlake-park-and-greenbelt",
        "name": "Westlake Park and Greenbelt",
        "category": "park",
        "address": "Westlake Drive and 134th Street, Broomfield, CO 80021",
        # A reservation contact number stated directly on this facility's
        # own page -- not a generic parks-department line reused across
        # every park (compare batch3's Broadlands East Park, which had
        # its own distinct number too).
        "phone": "303-464-5509",
        "website": "https://www.broomfield.org/Facilities/Facility/Details/34",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/34",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "midway-park",
        "name": "Midway Park",
        "category": "park",
        "address": "Midway Boulevard and Kohl Street, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/38",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/38",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "restrooms", "trails"],
        "accessibility_note": None,
        "hours": None,
    },
    {
        "slug": "columbine-meadows-parks",
        "name": "Columbine Meadows Parks",
        "category": "park",
        "address": "Hazel Street and Meadow Avenue, Broomfield, CO 80021",
        "phone": None,
        "website": "https://www.broomfield.org/Facilities/Facility/Details/12",
        "source_url": "https://www.broomfield.org/Facilities/Facility/Details/12",
        "is_free": True,
        "fee_note": None,
        "services": ["playground", "baseball_field", "soccer_field", "restrooms"],
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
