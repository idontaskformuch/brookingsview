"""One-time/periodic ingest of Brookings' official GIS open-data feed into
`facilities` -- see NEEDS-HUMAN-REVIEW.md, "Brookings Full Audit P3
(Facilities)". Same investigation-then-import pattern as
scripts/ingest_moval_facilities.py.

SOURCE: the City of Brookings publishes an ArcGIS Hub open-data site
(brookingsopendata-brookingscosd.hub.arcgis.com) -- confirmed public,
no robots.txt block, real DCAT catalog (see NEEDS-HUMAN-REVIEW.md
"Brookings Parity Audit" for the initial verification). Its "City Parks"
dataset item is a Web Mapping Application, not a bare FeatureServer link --
resolved by following item -> webmap -> operationalLayers to the real
FeatureServer: services5.arcgis.com/ghMlwLxET54qDmAf/arcgis/rest/services/
City_Parks/FeatureServer/177. 24 real Brookings parks confirmed live.

ONLY ONE LAYER ACTUALLY USABLE, unlike MoVal's four. The portal's other
datasets are either sub-features of parks already covered (Playground,
Shelter, Bathrooms_in_Parks, Dog_Waste_Trashes, Sport_Courts, Trails -- same
"don't fragment one park into several near-duplicate pages" reasoning as
MoVal's excluded MoValTrailHeads/MoValPicnicShelter) or not facility data at
all (Recreation Trails, Snow Removal Routes, Historic Districts, Future
Land Use Map, Zoning, Suitability Model, jurisdiction/annexation boundaries,
BATA bus routes, Garbage Schedule -- planning/infrastructure GIS layers, not
points of interest). One dataset, "Rentals", is NOT bookable community
facilities like MoVal's MoValRentalFacilities -- checked its actual schema
before assuming from the name, and it turned out to be the city's PRIVATE
RENTAL PROPERTY ASSESSOR REGISTRY: 1371 individual parcels with owner names,
deed holders, and tax values. Never used -- publishing named private
individuals' property data would violate this project's own house rule
against naming private individuals, entirely separate from whether it's
"facilities" data at all.

ADDRESSES: City_Parks is polygon geometry (park boundaries), not points
with a house-number address -- it has Street1-4 fields (bounding cross
streets) instead. Reverse-geocoding each park's centroid via Esri's public
World Geocoding Service (same service ingest_moval_facilities.py uses)
mostly returns only a locality-level match ("Brookings, South Dakota", no
street/postal) because a park's interior isn't near a street-address point
-- confirmed by testing a real residential coordinate nearby, which DID
resolve to a precise point address, so the geocoder itself works fine; park
interiors just don't have one. Rather than force a fabricated house-number
address, street_address is built from the park's own real cross-street
fields ("Western Ave & W 10th St"), and postal_code is left NULL unless the
geocoder happens to return one -- consistent with this table's own
has_resolved_address() semantics (a facility with no postal_code is
correctly ineligible for Event JSON-LD rich-result address claims, which is
the honest outcome here, not a bug to work around).

MERGE, NOT REPLACE: "Nature Park" in this GIS layer (cross streets "22nd
Ave / 32nd St S") is the same place as the hand-curated "Dakota Nature
Park" (slug dakota-nature-park, address "22nd Ave S and 32nd St S") --
matched via crosswalk, lat/lon filled in, existing curated
description/phone/hours/verified address kept untouched.

Usage:
    python -m scripts.ingest_brookings_facilities --config configs/brookings_sd.json
    python -m scripts.ingest_brookings_facilities --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests

from db.db import content_hash, get_conn

_LAYER_URL = "https://services5.arcgis.com/ghMlwLxET54qDmAf/arcgis/rest/services/City_Parks/FeatureServer/177/query"
_GEOCODE_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode"
_SOURCE_URL = "https://brookingsopendata-brookingscosd.hub.arcgis.com/apps/2ee88e2cc9ec45b1bf36e18aa2fff5b2"

# (town_id, slug) already hand-curated -- matched by normalized GIS park
# name so a merge updates lat/lon onto the EXISTING row instead of creating
# a duplicate. See module docstring.
_EXISTING_SLUG_CROSSWALK = {
    "nature park": "dakota-nature-park",
}

# "Mickelson Middle School" sits in the City_Parks layer (a shared-use
# athletic field on school grounds) but isn't itself a park -- categorized
# separately rather than mislabeled.
_SCHOOL_NAME_RE = re.compile(r"\bschool\b", re.IGNORECASE)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return re.sub(r"-+", "-", slug)


def _query_parks() -> list[dict]:
    r = requests.get(_LAYER_URL, params={
        "where": "1=1", "outFields": "*", "outSR": 4326,
        "returnCentroid": "true", "f": "json",
    }, timeout=30)
    r.raise_for_status()
    return r.json().get("features", [])


def _reverse_geocode(lon: float, lat: float) -> dict:
    """Best-effort street/postal lookup for a centroid -- see module
    docstring for why this often only returns a locality-level match for a
    park interior, which is the honest outcome, not a failure to fix."""
    try:
        r = requests.get(_GEOCODE_URL, params={"location": f"{lon},{lat}", "f": "json"}, timeout=15)
        r.raise_for_status()
        addr = r.json().get("address", {})
        return {"address": addr.get("Address") or None, "postal": addr.get("Postal") or None}
    except requests.RequestException:
        return {"address": None, "postal": None}


def _cross_streets(p: dict) -> str | None:
    streets = [p.get(f"Street{i}") for i in (1, 2, 3, 4)]
    streets = [s.strip() for s in streets if s and s.strip()]
    if not streets:
        return None
    return " & ".join(streets[:2])


def _description(p: dict) -> str | None:
    parts = []
    acres = (p.get("area_acres") or "").strip()
    purpose = (p.get("pri_purpose") or "").strip()
    if acres:
        try:
            parts.append(f"A {float(acres):g}-acre park in Brookings" + (f" ({purpose})." if purpose else "."))
        except ValueError:
            parts.append("A city park in Brookings.")
    elif purpose:
        parts.append(f"A city park in Brookings ({purpose}).")
    else:
        parts.append("A city park in Brookings.")

    amenities = []
    if (p.get("Playground") or "").strip().lower() == "yes":
        amenities.append("playground")
    ballfields = (p.get("Ballfields") or "").strip()
    if ballfields and ballfields.lower() != "none":
        amenities.append(ballfields.lower())
    restroom = (p.get("Restroom") or "").strip()
    if restroom and restroom.lower() != "none":
        amenities.append(f"{restroom} restrooms")
    if (p.get("onsite_prkg") or "").strip().lower() == "yes":
        amenities.append("on-site parking")
    pets = (p.get("pets") or "").strip()
    if pets:
        amenities.append(f"pets {pets.lower()}")
    sp_features = (p.get("sp_features") or "").strip()
    if sp_features:
        amenities.append(sp_features.lower())
    if amenities:
        parts.append(f"Amenities: {', '.join(amenities)}.")
    return " ".join(parts)


def gather_records() -> list[dict]:
    records = []
    for feature in _query_parks():
        p = feature.get("attributes", {})
        name = (p.get("Name1") or "").strip()
        if not name:
            continue
        centroid = feature.get("centroid") or {}
        lon, lat = centroid.get("x"), centroid.get("y")
        records.append({
            "name": name,
            "category": "other" if _SCHOOL_NAME_RE.search(name) else "park",
            "cross_streets": _cross_streets(p),
            "description": _description(p),
            "lon": lon,
            "lat": lat,
        })
    return records


def ingest(conn, town_id: str, records: list[dict], dry_run: bool) -> dict:
    inserted = updated = geocoded = 0
    with conn.cursor() as cur:
        for rec in records:
            crosswalk_slug = _EXISTING_SLUG_CROSSWALK.get(_normalize(rec["name"]))
            slug = crosswalk_slug or _slugify(rec["name"])

            postal_code = None
            street_address = rec["cross_streets"]
            if rec.get("lat") is not None and rec.get("lon") is not None:
                geo = _reverse_geocode(rec["lon"], rec["lat"])
                if geo["postal"]:
                    postal_code = geo["postal"]
                    geocoded += 1
                time.sleep(0.2)  # polite pacing, 24 records total

            full_address = (
                f"{street_address}, Brookings, SD" if street_address else "Brookings, SD"
            ) + (f" {postal_code}" if postal_code else "")
            chash = content_hash(town_id, slug, street_address, rec.get("lat"), rec.get("lon"))

            if dry_run:
                verb = "would update" if crosswalk_slug else "would insert"
                print(f"  {verb}: {slug} ({rec['name']}, {street_address}, {postal_code})")
                continue

            if crosswalk_slug:
                cur.execute(
                    """
                    UPDATE facilities
                       SET lat = %(lat)s, lon = %(lon)s, updated_at = now()
                     WHERE town_id = %(town_id)s AND slug = %(slug)s
                    """,
                    {"town_id": town_id, "slug": slug, "lat": rec.get("lat"), "lon": rec.get("lon")},
                )
                updated += 1
            else:
                cur.execute(
                    """
                    INSERT INTO facilities
                        (town_id, slug, name, category, address, street_address, postal_code,
                         aliases, description, website, hours_text, lat, lon,
                         source_url, verified_date, content_hash, updated_at)
                    VALUES
                        (%(town_id)s, %(slug)s, %(name)s, %(category)s, %(address)s,
                         %(street_address)s, %(postal_code)s, '{}', %(description)s,
                         NULL, NULL, %(lat)s, %(lon)s,
                         %(source_url)s, current_date, %(content_hash)s, now())
                    ON CONFLICT (town_id, slug) DO UPDATE SET
                        lat = EXCLUDED.lat, lon = EXCLUDED.lon,
                        postal_code = COALESCE(facilities.postal_code, EXCLUDED.postal_code),
                        content_hash = EXCLUDED.content_hash, updated_at = now()
                    """,
                    {"town_id": town_id, "slug": slug, "name": rec["name"], "category": rec["category"],
                     "address": full_address, "street_address": street_address, "postal_code": postal_code,
                     "description": rec.get("description"),
                     "lat": rec.get("lat"), "lon": rec.get("lon"),
                     "source_url": _SOURCE_URL, "content_hash": chash},
                )
                inserted += 1
        if not dry_run:
            conn.commit()
    return {"inserted": inserted, "updated": updated, "geocoded": geocoded}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    print("Fetching Brookings City_Parks layer...")
    records = gather_records()
    print(f"  {len(records)} parks")

    with get_conn() as conn:
        report = ingest(conn, town_id, records, args.dry_run)

    if not args.dry_run:
        print(f"\nInserted: {report['inserted']}  |  Updated (existing curated slugs): {report['updated']}  "
              f"|  Reverse-geocoded a postal code for: {report['geocoded']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
