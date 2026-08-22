"""One-time/periodic ingest of Moreno Valley's official GIS open-data feeds
into `facilities` -- see NEEDS-HUMAN-REVIEW.md, "3.1 Facilities sourcing".

SOURCE: the City of Moreno Valley publishes several public, unauthenticated
Esri ArcGIS Feature Services (found via MoVal GeoHub, gis-moval.opendata.
arcgis.com/data.json -- a standard DCAT catalog every ArcGIS Hub site
exposes for exactly this kind of programmatic discovery). Each layer's
"access" is explicitly "public" in its own ArcGIS item metadata -- the
city's own deliberate choice to publish this as open data, not something
found by working around a restriction. No robots.txt or terms-of-use
blocker applies (unlike rivcoacr.org's property-sales report): these are
query-capable REST endpoints meant for exactly this kind of consumption.

LAYERS USED:
  - MoValParks (35 parks) + MoValOtherParks (filtered to actual MV-address
    entries -- it also lists two regional attractions with Perris/Lakeview
    addresses, excluded, see _CITY_FILTER below)
  - MoValRentalFacilities (5 bookable community/senior centers)
  - City_and_Government_Offices (25 civic points of interest, filtered to
    City == "Moreno Valley" -- 3 entries have Perris/Riverside addresses,
    e.g. Val Verde USD's own office and the county DMV, genuinely useful
    civic info but not *in* the city, so excluded from a "local facilities"
    directory per the "local means local" house rule)
NOT USED: MoValTrailHeads, MoValPicnicShelter -- these are sub-features of
parks already listed (individual bookable picnic shelters, trail access
points), not distinct places; including them would fragment one park into
several near-duplicate facility pages.

POSTAL CODE: none of these layers include a ZIP field. Reverse-geocoded
from each record's own lat/lon via Esri's public World Geocoding Service
(geocode.arcgis.com, no key required, the same service this app's own
GIS viewer uses for its search widget) -- deriving a real fact from a
coordinate we already have, not inventing one.

MERGE, NOT REPLACE: several of these facilities were already hand-curated
in data/facilities/moreno_valley_ca.json with verified aliases (needed for
Event JSON-LD venue resolution, see ai_pipeline/venue_registry.py) before
this GIS source was found. Matching existing (town_id, slug) rows are
UPDATED (lat/lon filled in, address corrected if the live GIS data
disagrees) but keep their curated slug/aliases/phone/hours/description.
See _EXISTING_SLUG_CROSSWALK below -- one correction is worth flagging:
Shadow Mountain Park's address was recorded as 23239 Presidio Hills Dr
during the review-session venue cleanup (citing a General Plan PDF via
search), but this live, actively-maintained city GIS system says 23680 --
the same number three independent map providers (Yelp, TripAdvisor,
DogPack) already gave. Went with the GIS system as the more authoritative,
current source; recorded in NEEDS-HUMAN-REVIEW.md as a correction, not
silently overwritten.

Cross-layer duplicates (the same facility listed in two layers, e.g.
"Senior Community Center" in both Rental Facilities and Government
Offices) are deduped by exact normalized (name, address) match.

Usage:
    python -m scripts.ingest_moval_facilities --config configs/moreno_valley_ca.json
    python -m scripts.ingest_moval_facilities --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests

from db.db import content_hash, get_conn

_BASE = "https://services2.arcgis.com/WgPlP3PNKC8Glejs/arcgis/rest/services"
_GEOCODE_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode"

_PARK_LAYERS = [
    ("MoValParks", "park"),
    ("MoValOtherParks", "other"),
]
_RENTAL_LAYER = "MoValRentalFacilities"
_CIVIC_LAYER = "City_and_Government_Offices"

# Only include civic/park entries actually addressed within the city --
# "local means local". A few Government Offices entries have real MoVal
# relevance (Val Verde USD's office, the county DMV) but sit in Perris or
# Riverside; MoValOtherParks includes two state/county-run regional sites
# with Perris/Lakeview addresses. All excluded from this filter, not from
# the site -- they can still be mentioned in prose elsewhere.
_CITY_FILTER = "moreno valley"

# Encoding fix: Amenities text comes through as UTF-8 bytes that were
# already decoded once as cp1252 by an upstream system before reaching this
# API (classic double-encoding) -- "•" (E2 80 A2 in UTF-8) shows up as the
# three-character mojibake "â€¢". Round-tripping cp1252-encode ->
# utf-8-decode undoes exactly that one hop. Verified against real output
# (Celebration Park's Amenities field) before relying on it.
def _fix_mojibake(text: str | None) -> str | None:
    if not text:
        return text
    try:
        return text.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text  # already clean, or a genuinely different encoding issue -- leave as-is rather than mangle it


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


# Street-suffix abbreviations differ between layers for the SAME address
# ("25075 Fir Avenue" in Rental Facilities vs "25075 Fir Ave" in Government
# Offices) -- normalize for dedup-key comparison only, never for the
# address actually stored (which keeps whichever form the source record
# used).
_STREET_SUFFIX_RE = [
    (re.compile(r"\bavenue\b"), "ave"), (re.compile(r"\bstreet\b"), "st"),
    (re.compile(r"\blane\b"), "ln"), (re.compile(r"\bdrive\b"), "dr"),
    (re.compile(r"\bboulevard\b"), "blvd"), (re.compile(r"\bcircle\b"), "cir"),
]


def _normalize_address(text: str) -> str:
    norm = _normalize(text)
    for pattern, repl in _STREET_SUFFIX_RE:
        norm = pattern.sub(repl, norm)
    return norm


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return re.sub(r"-+", "-", slug)


# (town_id, slug) already hand-curated with verified aliases -- matched by
# the exact GIS layer name so a merge updates lat/lon/address onto the
# EXISTING row instead of creating a duplicate. See module docstring.
_EXISTING_SLUG_CROSSWALK = {
    "moreno valley public library": "main-library",
    "lasselle sports park": "lasselle-sports-park",
    "celebration park": "celebration-park",
    "shadow mountain park": "shadow-mountain-park",
    "moreno valley community park": "moreno-valley-community-park",
    "city hall/fire prevention": "city-hall",
}

# Same physical facility, listed under a shorter name in one layer --
# prefer the more descriptive name, drop the shorter duplicate.
_NAME_MERGE = {
    "cottonwood golf center": "Cottonwood Golf Center & Banquet Facility",
}

_CIVIC_CATEGORY_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\blibrary\b", re.I), "library"),
    (re.compile(r"\bcity hall\b", re.I), "city_hall"),
    (re.compile(r"\bpolice\b|\bpublic safety\b", re.I), "police"),
    (re.compile(r"\banimal shelter\b", re.I), "animal_shelter"),
    (re.compile(r"\busps\b|\bpost office\b|\bpostal\b", re.I), "post_office"),
    (re.compile(r"\bhospital\b|\bmedical center\b", re.I), "medical"),
    (re.compile(r"\bschool district\b", re.I), "school_district"),
    (re.compile(r"\bcommunity center\b|\brecreation center\b|\bsenior\b", re.I), "community_center"),
]


def _civic_category(name: str) -> str:
    for pattern, category in _CIVIC_CATEGORY_RULES:
        if pattern.search(name):
            return category
    return "other"


def _query_layer(layer: str) -> list[dict]:
    url = f"{_BASE}/{layer}/FeatureServer/0/query"
    r = requests.get(url, params={"where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson"}, timeout=30)
    r.raise_for_status()
    return r.json().get("features", [])


def _reverse_geocode_postal(lon: float, lat: float) -> str | None:
    try:
        r = requests.get(_GEOCODE_URL, params={"location": f"{lon},{lat}", "f": "json"}, timeout=15)
        r.raise_for_status()
        return r.json().get("address", {}).get("Postal") or None
    except requests.RequestException:
        return None


# MoValOtherParks (3 rows total, checked by hand) mixes in two
# state/county-run regional sites with Perris/Lakeview addresses -- not in
# the city, excluded from a "local facilities" directory. Named explicitly
# rather than filtered by an address heuristic: this layer is small and
# fixed enough that hardcoding is more reliable than pattern-matching a
# multi-line address field that doesn't consistently spell out the city.
_NON_MV_PARK_NAMES = {"lake perris state recreation area", "san jacinto wildlife area"}


def _park_record(feature: dict, category: str) -> dict | None:
    p = feature["properties"]
    name = (p.get("name") or "").strip()
    address = (p.get("Address") or "").strip()
    if not name or not address or _normalize(name) in _NON_MV_PARK_NAMES:
        return None
    coords = feature.get("geometry", {}).get("coordinates")
    amenities = _fix_mojibake(p.get("Amenities"))
    acreage = p.get("Acreage")
    description_parts = []
    if acreage:
        description_parts.append(f"A {acreage}-acre park in Moreno Valley.")
    else:
        description_parts.append("A city park in Moreno Valley.")
    if amenities:
        description_parts.append(f"Amenities: {amenities.strip(' •')}.")
    return {
        "name": name,
        "address": address,
        "category": category,
        "lon": coords[0] if coords else None,
        "lat": coords[1] if coords else None,
        "description": " ".join(description_parts),
        "website": p.get("website") or None,
        "hours_text": None,
    }


def _rental_record(feature: dict) -> dict:
    p = feature["properties"]
    coords = feature.get("geometry", {}).get("coordinates")
    amenities = _fix_mojibake(p.get("Amenities"))
    return {
        "name": (p.get("name") or "").strip(),
        "address": (p.get("Address") or "").strip(),
        "category": "community_center",
        "lon": coords[0] if coords else None,
        "lat": coords[1] if coords else None,
        "description": f"Amenities: {amenities.strip(' •')}." if amenities else None,
        "website": p.get("website") or None,
        "hours_text": None,
    }


def _civic_record(feature: dict) -> dict | None:
    p = feature["properties"]
    if _normalize(p.get("City") or "") != _CITY_FILTER:
        return None
    name = (p.get("Name") or "").strip()
    coords = feature.get("geometry", {}).get("coordinates")
    return {
        "name": name,
        "address": (p.get("Address") or "").strip(),
        "category": _civic_category(name),
        "lon": coords[0] if coords else None,
        "lat": coords[1] if coords else None,
        "description": None,
        "website": None,
        "hours_text": None,
    }


def gather_records() -> list[dict]:
    records: list[dict] = []

    for layer, category in _PARK_LAYERS:
        for feature in _query_layer(layer):
            rec = _park_record(feature, category)
            if rec and rec["address"]:
                records.append(rec)

    for feature in _query_layer(_RENTAL_LAYER):
        rec = _rental_record(feature)
        if rec["name"] and rec["address"]:
            records.append(rec)

    for feature in _query_layer(_CIVIC_LAYER):
        rec = _civic_record(feature)
        if rec and rec["name"] and rec["address"]:
            records.append(rec)

    # Name-merge known short-name duplicates before the exact-match dedup
    # below, so "Cottonwood Golf Center" (Parks) and "Cottonwood Golf
    # Center & Banquet Facility" (Rental) collapse into one entry.
    for rec in records:
        canonical = _NAME_MERGE.get(_normalize(rec["name"]))
        if canonical:
            rec["name"] = canonical

    # Exact (normalized name, normalized address) dedup across layers --
    # keeps the first-seen record, merging in a description from a later
    # duplicate if the first one didn't have one (parks copy has amenities
    # text; the same place's civic-offices copy doesn't).
    deduped: dict[tuple[str, str], dict] = {}
    for rec in records:
        key = (_normalize(rec["name"]), _normalize_address(rec["address"]))
        if key not in deduped:
            deduped[key] = rec
        elif not deduped[key].get("description") and rec.get("description"):
            deduped[key]["description"] = rec["description"]

    return list(deduped.values())


def ingest(conn, town_id: str, records: list[dict], dry_run: bool) -> dict:
    inserted = updated = geocoded = 0
    with conn.cursor() as cur:
        for rec in records:
            crosswalk_slug = _EXISTING_SLUG_CROSSWALK.get(_normalize(rec["name"]))
            slug = crosswalk_slug or _slugify(rec["name"])

            postal_code = None
            if rec.get("lat") is not None and rec.get("lon") is not None:
                postal_code = _reverse_geocode_postal(rec["lon"], rec["lat"])
                if postal_code:
                    geocoded += 1
                time.sleep(0.2)  # polite pacing against a free public service, ~90 records total

            street_address = rec["address"]
            full_address = f"{street_address}, Moreno Valley, CA" + (f" {postal_code}" if postal_code else "")
            chash = content_hash(town_id, slug, street_address, rec.get("lat"), rec.get("lon"))

            if dry_run:
                verb = "would update" if crosswalk_slug else "would insert"
                print(f"  {verb}: {slug} ({rec['name']}, {street_address}, {postal_code})")
                continue

            if crosswalk_slug:
                cur.execute(
                    """
                    UPDATE facilities
                       SET lat = %(lat)s, lon = %(lon)s,
                           street_address = COALESCE(street_address, %(street_address)s),
                           postal_code = COALESCE(postal_code, %(postal_code)s),
                           updated_at = now()
                     WHERE town_id = %(town_id)s AND slug = %(slug)s
                    """,
                    {"town_id": town_id, "slug": slug, "lat": rec.get("lat"), "lon": rec.get("lon"),
                     "street_address": street_address, "postal_code": postal_code},
                )
                # Shadow Mountain Park: the live GIS address disagrees with
                # the review-session's earlier entry -- see module
                # docstring. Correct it explicitly rather than only filling
                # NULLs (the COALESCE above intentionally never touches an
                # address a human already verified for every other row).
                if slug == "shadow-mountain-park":
                    cur.execute(
                        """
                        UPDATE facilities
                           SET street_address = %(street_address)s, address = %(address)s,
                               postal_code = %(postal_code)s, updated_at = now()
                         WHERE town_id = %(town_id)s AND slug = %(slug)s
                        """,
                        {"town_id": town_id, "slug": slug, "street_address": street_address,
                         "address": full_address, "postal_code": postal_code},
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
                         %(website)s, %(hours_text)s, %(lat)s, %(lon)s,
                         %(source_url)s, current_date, %(content_hash)s, now())
                    ON CONFLICT (town_id, slug) DO UPDATE SET
                        lat = EXCLUDED.lat, lon = EXCLUDED.lon,
                        postal_code = COALESCE(facilities.postal_code, EXCLUDED.postal_code),
                        content_hash = EXCLUDED.content_hash, updated_at = now()
                    """,
                    {"town_id": town_id, "slug": slug, "name": rec["name"], "category": rec["category"],
                     "address": full_address, "street_address": street_address, "postal_code": postal_code,
                     "description": rec.get("description"), "website": rec.get("website"),
                     "hours_text": rec.get("hours_text"),
                     "lat": rec.get("lat"), "lon": rec.get("lon"),
                     "source_url": "https://gis-moval.opendata.arcgis.com/",
                     "content_hash": chash},
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

    print("Fetching MoVal GeoHub layers...")
    records = gather_records()
    print(f"  {len(records)} unique facilities across parks/rental/civic layers")

    with get_conn() as conn:
        report = ingest(conn, town_id, records, args.dry_run)

    if not args.dry_run:
        print(f"\nInserted: {report['inserted']}  |  Updated (existing curated slugs): {report['updated']}  "
              f"|  Reverse-geocoded a postal code for: {report['geocoded']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
