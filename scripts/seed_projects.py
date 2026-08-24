"""Loads hand-curated civic project facts from data/projects/<town_id>.json
into the `projects` table (see db/migrations/023_city_hall_projects.sql).

WHY A SEPARATE SCRIPT, NOT A scrapers/parsers/*.py PARSER: same reasoning as
scripts/seed_facilities.py -- a project entity (title, description, the case
numbers that identify it) is hand-curated, not scraped from a machine-
readable feed, and changes rarely. Re-running is always safe: it upserts on
(town_id, slug), so editing the JSON and re-running updates that row instead
of creating a duplicate. `status` and the actual timeline are NOT set here --
those come only from real meeting outcomes via
ai_pipeline/project_updates.py, run separately after this.

Usage:
    python -m scripts.seed_projects                  # all towns with a JSON file
    python -m scripts.seed_projects moreno_valley_ca  # just one town
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from db.db import get_conn

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "projects"


def _load_town_file(town_id: str) -> list[dict]:
    path = DATA_DIR / f"{town_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No projects file for {town_id}: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload["projects"]


def seed_town(conn, town_id: str) -> tuple[int, int]:
    projects = _load_town_file(town_id)
    inserted = 0
    updated = 0
    for p in projects:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO projects
                    (town_id, slug, title, description, case_numbers,
                     legistar_matter_ids, location_text, home_sales_zip, updated_at)
                VALUES
                    (%(town_id)s, %(slug)s, %(title)s, %(description)s,
                     %(case_numbers)s, %(legistar_matter_ids)s,
                     %(location_text)s, %(home_sales_zip)s, now())
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    title                = EXCLUDED.title,
                    description          = EXCLUDED.description,
                    case_numbers         = EXCLUDED.case_numbers,
                    legistar_matter_ids  = EXCLUDED.legistar_matter_ids,
                    location_text        = EXCLUDED.location_text,
                    home_sales_zip       = EXCLUDED.home_sales_zip,
                    updated_at           = now()
                RETURNING (xmax = 0) AS inserted
                """,
                {
                    "town_id": town_id,
                    "slug": p["slug"],
                    "title": p["title"],
                    "description": p["description"],
                    "case_numbers": p.get("case_numbers") or [],
                    "legistar_matter_ids": p.get("legistar_matter_ids") or [],
                    "location_text": p.get("location_text"),
                    "home_sales_zip": p.get("home_sales_zip"),
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
            conn.commit()
            print(f"{town_id}: {inserted} inserted, {updated} updated")


if __name__ == "__main__":
    main()
