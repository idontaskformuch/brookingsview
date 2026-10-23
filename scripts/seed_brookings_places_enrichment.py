"""Brookings place-page enrichment (AdSense review, owner-ordered 2026-10-22): UPDATEs existing
`places` rows only (never inserts), by (town_id, slug), with facts read from each place's OWN official
page on 2026-10-23. A fact an official page did not state is left out (NULL), never guessed.

Two kinds of update:
  1. CURATED: hand-entered hours text, cost, services, accessibility, parking and visit notes for the
     museums, libraries, ice center and nature park (see CURATED; every entry names its sources).
  2. PARKS: the city's own GIS record already stores each park's amenities in `description` as
     "Amenities: playground, baseball, ..." (scripts/ingest_brookings_facilities.py); they are turned into
     the `services` list, and "on-site parking" into `parking_note`. Nothing is added that the record
     does not already say.

Needs db/migrations/062_places_parking_visit_notes.sql applied first (parking_note, visit_notes).

    python -m scripts.seed_brookings_places_enrichment --dry-run   # print every change, write nothing
    python -m scripts.seed_brookings_places_enrichment             # apply (live DB: owner approval first)
"""
from __future__ import annotations

import argparse
import re
from datetime import date

from db.db import get_conn

TOWN_ID = "brookings_sd"
TODAY = date.today().isoformat()

CURATED: list[dict] = [
    {
        "slug": "south-dakota-art-museum",
        "sources": ["https://www.sdstate.edu/south-dakota-art-museum"],
        "hours_text": "Mon-Fri 10 a.m.-5 p.m.; Sat 10 a.m.-4 p.m.; Sun noon-4 p.m. Closed Sundays January-March and on all state holidays.",
        "is_free": True,
        "fee_note": "Free admission for all.",
        "services": ["Permanent collection (including the Harvey Dunn, Oscar Howe, Marghab Linens and Paul Goble collections)",
                     "Rotating exhibitions", "Group education programs", "Summer performance series on Anderson Plaza"],
        "parking_note": "Just west of the museum on Harvey Dunn Street (926 Harvey Dunn St. on GPS). Check in at the front desk for a parking pass.",
        "visit_notes": "Plan your visit on the museum's Visit page. Group programs can be tailored to your group's interests.",
    },
    {
        "slug": "mccrory-gardens",
        "sources": ["https://www.sdstate.edu/mccrory-gardens"],
        "hours_text": "Summer (May-October): daily 10 a.m.-7 p.m., last admission 6:30 p.m. Winter (November-April): Mon-Fri 10 a.m.-5 p.m., last admission 4:30 p.m. Holiday closures are listed on the gardens' site.",
        "is_free": False,
        "fee_note": "Adults $6; seniors 65+ and youth 6-17 $4; children 5 and under free; military $4 with ID (all plus tax). Free for members, SDSU students and employees with ID, and on Community Days (fourth Wednesday, May-October).",
        "services": ["About 25 acres of formal gardens", "Walking paths", "South Dakota State Arboretum", "Seasonal displays", "Garden Glow winter event"],
        "accessibility_note": "The gardens state that accessible routes run throughout.",
        "visit_notes": "The gardens' 'Things to Know Before You Go' page covers visitor rules; check it for pets and other policies, which the main page does not state.",
    },
    {
        "slug": "south-dakota-agricultural-heritage-museum",
        "sources": ["https://www.sdstate.edu/south-dakota-agricultural-heritage-museum"],
        "hours_text": "Mon-Sat 10 a.m.-5 p.m.; Sun 1-5 p.m. Closed Sundays January-March.",
        "services": ["Exhibits on South Dakota agricultural history, culture and science", "Ag-Xploration Gallery and traveling exhibits",
                     "Collections of agricultural tools and artifacts", "Beckman Archive"],
        "visit_notes": "Admission, parking and accessibility are not listed on the museum's main page; the museum's Visit section or phone (605-688-6226) will have them.",
    },
    {
        "slug": "briggs-library",
        "sources": ["https://www.sdstate.edu/hilton-m-briggs-library"],
        "services": ["Research help (Ask @ Briggs)", "Study rooms (reserved online)", "SDSU Archives and Special Collections",
                     "Wokini Knowledge Circle (materials on Oceti Sakowin culture, history and people)", "Jackrabbit Gallery Art Show"],
        "visit_notes": "Hours are on SDSU's library hours guide (libguides.sdstate.edu/hours). The library's page does not say whether visitors outside SDSU can borrow materials: check its Visitor Information page or call 605-688-5107.",
    },
    {
        "slug": "childrens-museum-of-south-dakota",
        "sources": ["https://prairieplay.org/"],
        "hours_text": "Open 10 a.m.-5 p.m.; see the museum's Hours + Admission page for which days.",
        "is_free": False,
        "fee_note": "Ticket prices are on the museum's Hours + Admission page. The Access Initiative offers $3 daily admission for families who cannot pay the standard rate.",
        "services": ["Interactive, hands-on exhibits (including Mama T. Rex, a life-size animatronic dinosaur)", "KidStreet", "Maker Studio",
                     "Classes and camps (ages 0-12)", "Cafe Coteau", "Gift shop", "Family memberships"],
        "accessibility_note": "The museum has an Access for All page and offers sensory-friendly play events and private playtimes for families whose children could benefit from sensory accommodations.",
        "visit_notes": "Buy tickets online and check the Planning Tips + Info page before you visit. Call 605-692-6700 with questions about parking or pricing.",
    },
    {
        "slug": "public-library",
        "sources": ["https://www.brookingslibrary.org/"],
        "services": ["Library cards", "Printing from your own device", "Meeting and study rooms (booked online)", "Programs and events", "Maker Lab", "Notary service"],
    },
    {
        "slug": "larson-ice-center",
        "sources": ["https://www.cityofbrookings-sd.gov/308/Larson-Ice-Center"],
        "hours_text": "Public open skate (season begins September 20, 2026): Mon 10 a.m.-noon; Wed 6:30-8 p.m.; Thu 8-9:30 p.m.; Sun 3:30-5 p.m. Times are subject to change: call (605) 692-2708.",
        "is_free": False,
        "fee_note": "Admission $5 per person; skate rental $5 a pair; skate sharpening $5 a pair; 10-punch discount card $45.",
        "services": ["Public open skate", "Skate rental and sharpening", "Private ice rental"],
        "visit_notes": "Private ice rental is offered Friday, Saturday and Sunday evenings (skate rental not included); call the Parks and Recreation office at (605) 692-2708 for a quote. Updates to open skate times are posted on the Brookings Park and Recreation Facebook page.",
    },
    {
        "slug": "dakota-nature-park",
        "sources": ["https://www.cityofbrookings-sd.gov/313/Dakota-Nature-Park"],
        "hours_text": "Park: daily 6 a.m.-11 p.m., year-round. Larson Nature Center (1705 32nd St. S.): June to mid-August Wed-Fri noon-8 p.m., Sat 9 a.m.-8 p.m., Sun noon-8 p.m.; mid-August to May Sat 9 a.m.-5 p.m., Sun noon-5 p.m. The center is closed on all holidays, including Hobo Day.",
        "fee_note": "No park entry fee is listed. Equipment rentals ($10 per 1.5 hours for a mountain bike, kayak, paddle board or snowshoes; $10 per 2 hours for a fishing pole, binoculars or GPS unit) and facility rentals have fees.",
        "services": ["Trails with benches", "Fishing ponds", "Canoeing, kayaking and paddleboarding", "Snowshoeing and cross-country skiing (open year-round)",
                     "Larson Nature Center", "Equipment rentals"],
        "parking_note": "Parking lots are on site; no capacity details are published.",
        "visit_notes": "Dogs must be leashed at all times and waste cleaned up. No fires or fireworks. There are no garbage cans in the park: pack it in, pack it out. Fishing is catch and release and state regulations apply. Swimming is discouraged because water depth and clarity vary.",
    },
    {
        "slug": "edgebrook-golf-course",
        "sources": ["https://www.cityofbrookings-sd.gov/312/Parks"],
        "services": ["18 holes (6,200 yards, par 70)", "40 golf carts", "Driving range", "Practice greens", "Nine-hole par-3 course"],
    },
]

_AMENITY_RE = re.compile(r"Amenities:\s*(.+?)\.?\s*$", re.IGNORECASE | re.DOTALL)


def park_amenities(description: str | None) -> list[str]:
    """['playground', 'baseball', 'on-site parking', ...] from a GIS-built park description, or []."""
    m = _AMENITY_RE.search(description or "")
    if not m:
        return []
    return [a.strip() for a in m.group(1).split(",") if a.strip()]


def park_update(description: str | None) -> dict | None:
    """services + parking_note for a park, using only what its own record states."""
    amenities = park_amenities(description)
    if not amenities:
        return None
    # "pets no" is an ambiguous GIS code (not allowed? not recorded?): left out rather than interpreted.
    services = [a[:1].upper() + a[1:] for a in amenities if "parking" not in a.lower() and a.lower() != "pets no"]
    has_parking = any("parking" in a.lower() for a in amenities)
    return {"services": services or None,
            "parking_note": "On-site parking (per the city's park records)." if has_parking else None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    with get_conn() as conn, conn.cursor() as cur:
        changed = 0
        for item in CURATED:
            cols = {k: v for k, v in item.items() if k not in ("slug", "sources")}
            cur.execute("SELECT 1 FROM places WHERE town_id = %s AND slug = %s", (TOWN_ID, item["slug"]))
            if cur.fetchone() is None:
                raise RuntimeError(f"no place with slug {item['slug']!r}")
            print(f"[curated] {item['slug']}: set {', '.join(cols)}  (sources: {', '.join(item['sources'])})")
            if not args.dry_run:
                sets = ", ".join(f"{c} = %({c})s" for c in cols)
                cur.execute(
                    f"UPDATE places SET {sets}, verification_method = 'manual', verified_date = %(today)s, updated_at = now() "
                    f"WHERE town_id = %(town_id)s AND slug = %(slug)s",
                    {**cols, "today": TODAY, "town_id": TOWN_ID, "slug": item["slug"]},
                )
            changed += 1
        cur.execute("SELECT slug, description FROM places WHERE town_id = %s AND category = 'park' ORDER BY slug", (TOWN_ID,))
        curated_slugs = {i["slug"] for i in CURATED}
        for slug, description in cur.fetchall():
            if slug in curated_slugs:
                continue
            upd = park_update(description)
            if not upd:
                print(f"[park] {slug}: no amenities in record, unchanged")
                continue
            print(f"[park] {slug}: services={upd['services']} parking_note={upd['parking_note']!r}")
            if not args.dry_run:
                cur.execute(
                    "UPDATE places SET services = %(services)s, parking_note = %(parking_note)s, updated_at = now() "
                    "WHERE town_id = %(town_id)s AND slug = %(slug)s",
                    {**upd, "town_id": TOWN_ID, "slug": slug},
                )
            changed += 1
        if args.dry_run:
            conn.rollback()
        print(f"{changed} places {'would be updated (dry run, nothing written)' if args.dry_run else 'updated'}")


if __name__ == "__main__":
    main()
