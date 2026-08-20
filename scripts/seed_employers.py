"""Loads the hand-curated Worker Pulse / Workplace Watch employer list from
data/employers/<town_id>.json into the `employers` table (see
db/migrations/016_workplace_watch.sql).

Same "manual file, no HTTP fetch" pattern as scripts/seed_facilities.py:
Glassdoor/Indeed have no public API and block scraping, and the employer
roster itself (name, links, accent color) changes rarely -- a human edits
the JSON when a new employer is added. Re-running this script is always
safe: it upserts on (town_id, slug).

Usage:
    python -m scripts.seed_employers                  # all towns with a JSON file
    python -m scripts.seed_employers moreno_valley_ca  # just one town
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from db.db import content_hash, get_conn

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "employers"


def _load_town_file(town_id: str) -> list[dict]:
    path = DATA_DIR / f"{town_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No employers file for {town_id}: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload["employers"]


def seed_town(conn, town_id: str) -> tuple[int, int]:
    employers = _load_town_file(town_id)
    inserted = 0
    updated = 0
    with conn.cursor() as cur:
        for e in employers:
            chash = content_hash(
                town_id, e["slug"], e["name"], e.get("facility_type"),
                e.get("glassdoor_url"), e.get("indeed_url"), e.get("accent_color"),
            )
            cur.execute(
                """
                INSERT INTO employers
                    (town_id, slug, name, facility_type, glassdoor_url,
                     indeed_url, accent_color, content_hash, updated_at)
                VALUES
                    (%(town_id)s, %(slug)s, %(name)s, %(facility_type)s,
                     %(glassdoor_url)s, %(indeed_url)s, %(accent_color)s,
                     %(content_hash)s, now())
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    name          = EXCLUDED.name,
                    facility_type = EXCLUDED.facility_type,
                    glassdoor_url = EXCLUDED.glassdoor_url,
                    indeed_url    = EXCLUDED.indeed_url,
                    accent_color  = EXCLUDED.accent_color,
                    content_hash  = EXCLUDED.content_hash,
                    updated_at    = now()
                RETURNING (xmax = 0) AS inserted
                """,
                {
                    "town_id": town_id,
                    "slug": e["slug"],
                    "name": e["name"],
                    "facility_type": e["facility_type"],
                    "glassdoor_url": e.get("glassdoor_url"),
                    "indeed_url": e.get("indeed_url"),
                    "accent_color": e.get("accent_color"),
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
