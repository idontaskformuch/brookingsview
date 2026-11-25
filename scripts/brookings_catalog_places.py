"""Owner order 2026-11-25, punkt 3a/3b: nine Brookings places from the City's facility catalog and five catalog names as
name_aliases of rows we already have. Address, phone and position verbatim from each catalog Details page (read through
PoliteFetcher 2026-11-25, saved copy of the day: scratch_tmp/catalog_14.jsonl); hours are NOT written here, except the pool's:
`python -m scrapers.facility_hours brookings-catalog --all-pages --apply` fills the rest from the same pages afterwards.

    python -m scripts.brookings_catalog_places                 # dry run
    python -m scripts.brookings_catalog_places --apply --prod  # ALLOW_PROD_WRITE=brookings_catalog_places + backup first

* The pool keeps the catalog's text with no structure (no open/closed pill): the season has no exact dates. Its
  verification_method is 'manual', so the catalog run reports it and never parses it into weekly hours.
* The Municipal Liquor Store is a municipal facility (category 'other', public, indexable), not a 'shopping' venue.
* Camelot/Mickelson school parks become aliases only when the catalog's pin and our row are within 200 m.
"""
from __future__ import annotations

import math
import sys
from datetime import date

from db.db import get_conn

TOWN = "brookings_sd"
DETAILS = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/"
TODAY = date.today()
POOL_TEXT = "Swim season begins the end of May - Mid August | OPEN SWIM: 1-7 p.m. daily"

# slug, catalog name, category, street address, phone, lat, lon, Details page
NEW = [
    ("hillcrest-aquatic-center", "Hillcrest Aquatic Center", "leisure", "1505 5th Street North", "(605) 692-2387",
     44.3102773539177, -96.7786599911095, "Hillcrest-Aquatic-Center-37"),
    ("brookings-activity-center", "Brookings Activity Center", "community_center", "320 5th Ave", "(605) 692-4492",
     44.3088180172741, -96.7963959913636, "Brookings-Activity-Center-69"),
    ("public-safety-center", "Public Safety Center", "police", "307 3rd Avenue", "(605) 692-2113",
     44.3080483099984, -96.8002136629968, "Public-Safety-Center-18"),
    ("landfill-office-collection-shop", "Landfill Office & Collection Shop", "recycling", "47532 30th St.", "(605) 693-3667",
     44.3406549699994, -96.7549337399984, "Landfill-Office-Collection-Shop-52"),
    ("central-park", "Central Park", "park", "Sixth Avenue and Fifth Street", "(605) 692-2708",
     44.3103249999993, -96.7952149999983, "Central-Park-47"),
    ("pheasant-nest-park", "Pheasant Nest Park", "park", "12th Street South and 7th Avenue South", "(605) 692-2708",
     44.3018474508995, -96.7884486541797, "Pheasant-Nest-Park-32"),
    ("northbrook-park-community-gardens", "Northbrook Park - Community Gardens", "park", "2250 Medary Avenue North",
     "(605) 692-2708", 44.3259100589549, -96.7883398927678, "Northbrook-Park-Community-Gardens-42"),
    ("medary-elementary-school-park", "Medary Elementary School Park", "park", "718 5th Street South", "(605) 692-2708",
     44.3001240139354, -96.7923760306038, "Medary-Elementary-School-Park-29"),
    ("brookings-municipal-liquor-store", "Brookings Municipal Liquor Store", "other", "780 22nd Ave. So.", "(605) 692-5613",
     44.297218280997, -96.7682622679934, "Brookings-Municipal-Liquor-Store-9"),
]

# our slug, catalog name, catalog pin (lat, lon) or None when no distance rule applies
ALIASES = [
    ("city-hall", "City and County Government Center", None),
    ("prairie-park", "Brookings Prairie", None),
    ("sexauer-park", "Sexauer Park & Campground", None),
    ("camelot-park", "Camelot Intermediate School Park", (44.2901839999962, -96.7839719999917)),
    ("mickelson-middle-school", "Mickelson Middle School Park", (44.2921859999985, -96.7777109999967)),
]
MAX_ALIAS_M = 200


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, slug, name, lat, lon, name_aliases FROM places WHERE town_id = %s", (TOWN,))
        rows = {r[1]: r for r in cur.fetchall()}
        for slug, name, cat, street, phone, lat, lon, page in NEW:
            if slug in rows:
                print(f"[exists] {slug}: not inserted")
                continue
            near = sorted((metres((lat, lon), (r[3], r[4])), r[1]) for r in rows.values() if r[3] is not None)[:1]
            note = f" (nearest row {near[0][1]} {near[0][0]:.0f} m)" if near else ""
            print(f"[{'insert' if apply else 'dry-run'}] {slug} {name!r} {cat} {street!r} {phone}{note}")
            if apply:
                pool = slug == "hillcrest-aquatic-center"
                cur.execute(
                    "INSERT INTO places (town_id, slug, name, category, address, street_address, postal_code, phone, lat, lon, "
                    "source_url, verified_date, verification_method, hours_text, content_hash, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, '57006', %s, %s, %s, %s, %s, %s, %s, %s, now()) RETURNING id",
                    (TOWN, slug, name, cat, f"{street}, Brookings, SD 57006", street, phone, lat, lon, DETAILS + page, TODAY,
                     "manual" if pool else None, POOL_TEXT if pool else None, f"place-manual-{slug}"))
        for slug, alias, pin in ALIASES:
            r = rows.get(slug)
            if r is None:
                print(f"[missing] {slug}")
                continue
            if pin is not None:
                d = metres(pin, (r[3], r[4]))
                if d > MAX_ALIAS_M:
                    print(f"[skip] {slug} <- {alias!r}: catalog pin {d:.0f} m from our row (> {MAX_ALIAS_M} m)")
                    continue
                print(f"    {slug}: catalog pin {d:.0f} m from our row")
            if alias in (r[5] or []):
                print(f"[same] {slug} already has {alias!r}")
                continue
            print(f"[{'alias' if apply else 'dry-run'}] {slug} (id {r[0]}) name_aliases += {alias!r}")
            if apply:
                cur.execute("UPDATE places SET name_aliases = array_append(name_aliases, %s), updated_at = now() WHERE id = %s",
                            (alias, r[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
