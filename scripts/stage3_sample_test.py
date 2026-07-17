"""Stage 3-test: kör AI-formateringslagret mot ett urval RIKTIG data från Neon.

Plockar några rader ur varje tabell, kör dem genom format_record() (samma
funktion produktionspipelinen kommer använda), och skriver ut resultatet så du
kan bedöma om tonen, faktatroheten och guardrails håller mot skarp data --
inte bara mot min handskrivna testtext.

Körning:
    python -m scripts.stage3_sample_test --config configs/brookings_sd.json

Kräver DATABASE_URL och ANTHROPIC_API_KEY i .env.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline.format_prompt import format_record, _spent_this_month


QUERIES: dict[str, tuple[str, str]] = {
    # source_type: (SQL, beskrivning)
    "meeting": (
        """
        SELECT body, meeting_date, agenda_url, raw_data
        FROM meetings
        WHERE raw_data ? 'agenda_text'
        ORDER BY meeting_date DESC
        LIMIT 2
        """,
        "möten MED extraherad agenda-text (bästa testet för extraktiv AI-formatering)",
    ),
    "event": (
        """
        SELECT title, starts_at, ends_at, venue, source, raw_data
        FROM events
        WHERE source = 'library'
        ORDER BY starts_at ASC
        LIMIT 2
        """,
        "bibliotekshändelser (LibCal, riktig ICS-data)",
    ),
    "sports": (
        """
        SELECT sport, opponent, home_away, starts_at, venue, result
        FROM sports_games
        ORDER BY starts_at ASC
        LIMIT 2
        """,
        "SDSU-matcher (går via MALL, ingen AI -- kontroll att pipelinen fortfarande fungerar)",
    ),
    "weather": (
        """
        SELECT observed_for, payload
        FROM weather_snapshots
        ORDER BY observed_for DESC
        LIMIT 1
        """,
        "väder (mall)",
    ),
    "ag": (
        """
        SELECT commodity, price, unit, as_of
        FROM ag_prices
        ORDER BY created_at DESC
        LIMIT 2
        """,
        "råvarupriser (mall)",
    ),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))

    print(f"AI-spend hittills denna månad: ${_spent_this_month():.4f} "
          f"(tak: ${cfg.get('ai', {}).get('monthly_budget_usd', 20)})\n")

    with psycopg.connect(_env_database_url(), row_factory=dict_row) as conn:
        for source_type, (sql, desc) in QUERIES.items():
            print("=" * 78)
            print(f"KÄLLTYP: {source_type}  ({desc})")
            print("=" * 78)
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()

            if not rows:
                print("  (inga rader hittades -- kör motsvarande scraper-källa först)\n")
                continue

            for row in rows:
                result = format_record(dict(row), source_type, cfg)
                flag = "✅ AI" if result.generated_by.startswith("ai:") else \
                       "📋 mall" if result.generated_by == "template" else \
                       "⚠️  MALL-FALLBACK (guardrail blockerade AI-svaret)"
                print(f"\n  [{flag}] genererad_av={result.generated_by} verified={result.verified}")
                print(f"  → {result.text}\n")
            print()

    print(f"AI-spend efter test: ${_spent_this_month():.4f}")
    return 0


def _env_database_url() -> str:
    import os
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL saknas i .env")
    return url


if __name__ == "__main__":
    raise SystemExit(main())
