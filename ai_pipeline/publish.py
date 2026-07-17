"""Publish-pipeline -- Stage 3 (AI-formatering) -> stories.

Går igenom rader i källtabellerna (meetings, events, sports_games,
weather_snapshots, ag_prices), formaterar dem via ai_pipeline.format_prompt,
och skriver resultatet till `stories` med full proveniens (source_url,
snapshot_id, generated_by, verified).

Idempotent: en deterministisk slug ("{source_type}-{radens id}") kombinerat med
den redan existerande UNIQUE(town_id, slug)-constrainten gör att en omkörning
varken skapar dubbletter eller spenderar AI-budget på redan publicerade rader --
existerande slugs kollas INNAN format_record() anropas, inte efter.

Medvetet designval: SELECT * istället för namngivna kolumner. Det gör scriptet
motståndskraftigt mot att schemat och den här filen glider isär över tid (se
lärdomen om configs/brookings_sd.json tidigare i projektet, där en stale lokal
kopia av ett config-block av misstag skrev över verifierat arbete). Fält som
bara finns på vissa tabeller (t.ex. snapshot_id) plockas ut med .get(), inte
med en hårdkodad kolumnlista som kan bli fel.

Körning:
    python -m ai_pipeline.publish --config configs/brookings_sd.json
    python -m ai_pipeline.publish --config configs/brookings_sd.json --only meetings events
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline.format_prompt import format_record

# källtabell -> source_type (samma source_type-namn som format_record förväntar sig)
SOURCES: dict[str, str] = {
    "meetings": "meeting",
    "events": "event",
    "sports_games": "sports",
    "weather_snapshots": "weather",
    "ag_prices": "ag",
}


def build_title(table: str, row: dict) -> str:
    if table == "meetings":
        body = row.get("body") or "Meeting"
        date = row.get("meeting_date")
        return f"{body} — {date}" if date else str(body)
    if table == "events":
        return row.get("title") or "Event"
    if table == "sports_games":
        opp = row.get("opponent") or "TBD"
        prep = "vs" if row.get("home_away") == "home" else "at"
        sport = row.get("sport") or "Jackrabbits"
        return f"SDSU {sport}: {prep} {opp}"
    if table == "weather_snapshots":
        return f"Weather update — {row.get('observed_for')}"
    if table == "ag_prices":
        return f"{str(row.get('commodity') or '').title()} price update"
    return "Update"


def build_source_url(table: str, row: dict) -> str | None:
    if table == "meetings":
        return row.get("agenda_url")
    if table == "events":
        return row.get("url")
    return None


def existing_slugs(conn, town_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug FROM stories WHERE town_id = %s", (town_id,))
        return {r[0] for r in cur.fetchall()}


def publish_table(conn, cfg: dict, table: str, source_type: str,
                  known_slugs: set[str]) -> tuple[int, int]:
    town_id = cfg["town_id"]
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT * FROM {table} WHERE town_id = %s ORDER BY id", (town_id,))
        rows = cur.fetchall()

    published = skipped = 0
    for row in rows:
        slug = f"{source_type}-{row['id']}"
        if slug in known_slugs:
            skipped += 1
            continue

        result = format_record(dict(row), source_type, cfg)
        title = build_title(table, row)
        source_url = build_source_url(table, row)
        snapshot_id = row.get("snapshot_id")  # saknas på vissa tabeller -- .get() med flit

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, source_url,
                     snapshot_id, generated_by, verified, published_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (town_id, slug) DO NOTHING
                """,
                (town_id, title, slug, result.text, source_type, source_url,
                 snapshot_id, result.generated_by, result.verified,
                 datetime.now(timezone.utc)),
            )
        known_slugs.add(slug)
        published += 1
    return published, skipped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", nargs="*", help="begränsa till dessa tabeller")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        known = existing_slugs(conn, town_id)
        print(f"{len(known)} stories finns redan för {town_id}\n")

        total_pub = total_skip = 0
        for table, source_type in SOURCES.items():
            if args.only and table not in args.only:
                continue
            pub, skip = publish_table(conn, cfg, table, source_type, known)
            print(f"  {table:20} -> {pub} nya, {skip} redan publicerade")
            total_pub += pub
            total_skip += skip
        conn.commit()

    print(f"\nTotalt: {total_pub} nya stories, {total_skip} hoppade (redan fanns)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
