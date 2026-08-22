"""Loads hand-curated facility facts from data/facilities/<town_id>.json into
the `facilities` table (see db/migrations/007_facilities.sql).

WHY A SEPARATE SCRIPT, NOT A scrapers/parsers/*.py PARSER: everything else in
scrapers/parsers/ fetches from a live source on a schedule (see runner.py +
data_sources in configs/<town_id>.json). Facility facts (address, phone,
hours) don't have a machine-readable feed and change rarely -- a human
re-checks the source site every so often and edits the JSON file directly,
the same "manual file, no HTTP fetch" pattern rivco_property_sales_v1.py uses
for the quarterly property-sales report. Re-running this script is always
safe: it upserts on (town_id, slug), so editing a JSON value and re-running
updates that row instead of creating a duplicate.

Usage:
    python -m scripts.seed_facilities                  # all towns with a JSON file
    python -m scripts.seed_facilities moreno_valley_ca  # just one town
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from db.db import content_hash, get_conn

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "facilities"


def _load_town_file(town_id: str) -> list[dict]:
    path = DATA_DIR / f"{town_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No facilities file for {town_id}: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload["facilities"]


def seed_town(conn, town_id: str) -> tuple[int, int]:
    facilities = _load_town_file(town_id)
    inserted = 0
    updated = 0
    with conn.cursor() as cur:
        for f in facilities:
            chash = content_hash(
                town_id, f["slug"], f["name"], f.get("address"), f.get("phone"),
                f.get("hours_text"), f.get("description"),
            )
            cur.execute(
                """
                INSERT INTO facilities
                    (town_id, slug, name, category, address, street_address,
                     postal_code, aliases, phone, website, hours_text,
                     description, lat, lon, source_url, verified_date,
                     content_hash, updated_at)
                VALUES
                    (%(town_id)s, %(slug)s, %(name)s, %(category)s, %(address)s,
                     %(street_address)s, %(postal_code)s, %(aliases)s,
                     %(phone)s, %(website)s, %(hours_text)s, %(description)s,
                     %(lat)s, %(lon)s, %(source_url)s, %(verified_date)s,
                     %(content_hash)s, now())
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    name           = EXCLUDED.name,
                    category       = EXCLUDED.category,
                    address        = EXCLUDED.address,
                    street_address = EXCLUDED.street_address,
                    postal_code    = EXCLUDED.postal_code,
                    aliases        = EXCLUDED.aliases,
                    phone          = EXCLUDED.phone,
                    website        = EXCLUDED.website,
                    hours_text     = EXCLUDED.hours_text,
                    description    = EXCLUDED.description,
                    lat            = EXCLUDED.lat,
                    lon            = EXCLUDED.lon,
                    source_url     = EXCLUDED.source_url,
                    verified_date  = EXCLUDED.verified_date,
                    content_hash   = EXCLUDED.content_hash,
                    updated_at     = now()
                RETURNING (xmax = 0) AS inserted
                """,
                {
                    "town_id": town_id,
                    "slug": f["slug"],
                    "name": f["name"],
                    "category": f["category"],
                    "address": f.get("address"),
                    "street_address": f.get("street_address"),
                    "postal_code": f.get("postal_code"),
                    "aliases": f.get("aliases") or [],
                    "phone": f.get("phone"),
                    "website": f.get("website"),
                    "hours_text": f.get("hours_text"),
                    "description": f.get("description"),
                    "lat": f.get("lat"),
                    "lon": f.get("lon"),
                    "source_url": f.get("source_url"),
                    "verified_date": f.get("verified_date"),
                    "content_hash": chash,
                },
            )
            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1
    return inserted, updated


def main() -> None:
    town_ids = sys.argv[1:] or [p.stem for p in DATA_DIR.glob("*.json")]
    with get_conn() as conn:
        for town_id in town_ids:
            inserted, updated = seed_town(conn, town_id)
            print(f"{town_id}: {inserted} inserted, {updated} updated")


if __name__ == "__main__":
    main()
