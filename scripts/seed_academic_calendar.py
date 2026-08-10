"""Loads hand-curated SDSU academic-calendar dates from
data/academic_calendar/<town_id>.json into the `academic_calendar_dates`
table (see db/migrations/014_academic_calendar.sql).

WHY A SEPARATE SCRIPT, NOT A scrapers/parsers/*.py PARSER: same reasoning as
scripts/seed_facilities.py -- key academic dates (term start, breaks, finals,
commencement) change twice a year, not something worth a scheduled scraper
for. A human re-reads sdstate.edu/academics/academic-calendar each term and
edits the JSON file directly. Re-running this script is always safe: it
upserts on (town_id, label, starts_on), so editing a value and re-running
updates that row instead of creating a duplicate.

Usage:
    python -m scripts.seed_academic_calendar               # all towns with a JSON file
    python -m scripts.seed_academic_calendar brookings_sd   # just one town
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from db.db import content_hash, get_conn

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "academic_calendar"


def _load_town_file(town_id: str) -> list[dict]:
    path = DATA_DIR / f"{town_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No academic-calendar file for {town_id}: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload["dates"]


def seed_town(conn, town_id: str) -> tuple[int, int]:
    dates = _load_town_file(town_id)
    inserted = 0
    updated = 0
    with conn.cursor() as cur:
        for d in dates:
            chash = content_hash(
                town_id, d["label"], d["starts_on"], d.get("ends_on"), d.get("term"),
            )
            cur.execute(
                """
                INSERT INTO academic_calendar_dates
                    (town_id, label, term, category, starts_on, ends_on,
                     source_url, verified_date, content_hash, updated_at)
                VALUES
                    (%(town_id)s, %(label)s, %(term)s, %(category)s, %(starts_on)s,
                     %(ends_on)s, %(source_url)s, %(verified_date)s, %(content_hash)s, now())
                ON CONFLICT (town_id, label, starts_on) DO UPDATE SET
                    term          = EXCLUDED.term,
                    category      = EXCLUDED.category,
                    ends_on       = EXCLUDED.ends_on,
                    source_url    = EXCLUDED.source_url,
                    verified_date = EXCLUDED.verified_date,
                    content_hash  = EXCLUDED.content_hash,
                    updated_at    = now()
                RETURNING (xmax = 0) AS inserted
                """,
                {
                    "town_id": town_id,
                    "label": d["label"],
                    "term": d.get("term"),
                    "category": d.get("category"),
                    "starts_on": d["starts_on"],
                    "ends_on": d.get("ends_on"),
                    "source_url": d.get("source_url", "https://www.sdstate.edu/academics/academic-calendar"),
                    "verified_date": d.get("verified_date"),
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
