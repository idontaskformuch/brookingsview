"""Copies the text fields of ONE place from data/facilities/<town_id>.json into its `places` row.

A narrow alternative to scripts/seed_facilities.py, which rewrites every row of a town (name, address, lat/lon ...) and so can undo
changes made to other rows since the file was last seeded. This touches only description, hours_text, phone, verified_date and
content_hash (same hash as seed_facilities.py) of the slugs given.

Live DB (CLAUDE.md rule 14): back up first, then run with --prod and ALLOW_PROD_WRITE=update_place_from_json:
    python -m scripts.prod_backup update_place_from_json "SELECT * FROM places WHERE town_id = '<town>' AND slug IN ('<slug>')"
    ALLOW_PROD_WRITE=update_place_from_json python -m scripts.update_place_from_json --prod <town_id> <slug> [<slug> ...]
"""
from __future__ import annotations

import json
import sys

from db.db import content_hash, get_conn
from scripts.seed_facilities import DATA_DIR


def update_places(conn, town_id: str, slugs: list[str]) -> list[str]:
    facilities = {f["slug"]: f for f in json.loads((DATA_DIR / f"{town_id}.json").read_text(encoding="utf-8"))["facilities"]}
    missing = [s for s in slugs if s not in facilities]
    if missing:
        raise SystemExit(f"Not in data/facilities/{town_id}.json: {', '.join(missing)}")
    done = []
    with conn.cursor() as cur:
        for slug in slugs:
            f = facilities[slug]
            chash = content_hash(town_id, f["slug"], f["name"], f.get("address"), f.get("phone"), f.get("hours_text"), f.get("description"))
            cur.execute(
                """UPDATE places SET description = %s, hours_text = %s, phone = %s, verified_date = %s, content_hash = %s, updated_at = now()
                    WHERE town_id = %s AND slug = %s""",
                (f.get("description"), f.get("hours_text"), f.get("phone"), f.get("verified_date"), chash, town_id, slug),
            )
            if cur.rowcount != 1:
                raise SystemExit(f"{slug}: expected 1 row, got {cur.rowcount}; nothing committed")
            done.append(slug)
    conn.commit()
    return done


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    with get_conn() as conn:
        for slug in update_places(conn, argv[0], argv[1:]):
            print(f"updated {argv[0]}/{slug}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
