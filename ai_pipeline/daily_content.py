"""Daglig innehållsgenerering -- Innehållsspår v1, Steg 4.

Kör en gång/dag: läser dagens innehållstyp ur scheduler.weekly_rotation, bygger
lokalt underlag ur redan skrapade och guardrail-godkända stories (se
content/local_context.py), genererar via rätt modul i content/kronikor, och
skriver till stories vid pass.

Alla sex innehållstyper är kopplade in. Skulle scheduler.weekly_rotation ändå
peka på en typ utan MODULES-post skrivs det ut och körningen avslutas rent (inget
AI-anrop, inget fel kastat) -- men se _missing-kontrollen nedan, som redan fångar
den situationen vid import om ROTATION och MODULES går isär.

Idempotens: sluggen är deterministisk per dag ("kultur_essa-2026-07-21"), så en
omkörning samma dag skriver över samma rad i stället för att duplicera.

Körning:
    python -m ai_pipeline.daily_content --config configs/brookings_sd.json
    python -m ai_pipeline.daily_content --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg

from content import local_context, media_watchlist, seasonal_ingredients
from content._base import DEFAULT_MODEL, illustration_theme
from content.illustrations.generate_illustration import generate_illustration
from content.kronikor import kultur_essa, kvick_essa, ledare, vetenskap
from content.recensioner import media_recension
from content.recept import vardagsmiddag
from scheduler.weekly_rotation import ROTATION, content_type_for

PUBLIC_DIR = Path("site/public")

# Dispatch-nyckeln MÅSTE matcha scheduler.weekly_rotation.ROTATION:s värden exakt,
# INTE modulens filnamn -- vetenskap.py:s rotationsvärde är "vetenskap_kronika", inte
# "vetenskap". En felskriven nyckel här gör att en veckodag tyst hoppar över sig
# själv för alltid ("ingen modul kopplad") utan att något fel någonsin syns.
MODULES = {
    "kultur_essa": (kultur_essa.write, kultur_essa.CATEGORY),
    "ledare": (ledare.write, ledare.CATEGORY),
    "vetenskap_kronika": (vetenskap.write, vetenskap.CATEGORY),
    "kvick_essa": (kvick_essa.write, kvick_essa.CATEGORY),
    "media_recension": (media_recension.write, media_recension.CATEGORY),
    "vardagsmiddag": (vardagsmiddag.write, vardagsmiddag.CATEGORY),
}

_missing = set(ROTATION.values()) - set(MODULES)
assert not _missing, (
    f"scheduler.weekly_rotation.ROTATION references content type(s) with no matching "
    f"MODULES entry: {_missing}. Every rotation value must have an exact-match dispatch "
    f"key here, or that weekday silently publishes nothing forever."
)

ORIGINALITY_LOOKBACK_DAYS = 60


def _build_local_input(conn, town_id: str, content_type: str,
                        today: datetime.date) -> tuple[str | None, str]:
    """Content-type-aware underlag sourcing.

    media_recension and vardagsmiddag need a different KIND of underlag (a
    specific film/show, a seasonal ingredient) than the civic-affairs types --
    feeding them recent city-council/event data would be a genre mismatch, not
    a crash, which is exactly the kind of bug that's easy to miss. Returns
    (local_input, description); local_input is None only when there's genuinely
    nothing to build from (local_context's civic-data path).
    """
    if content_type == "media_recension":
        pick = media_watchlist.next_pick(today)
        return (media_watchlist.build_local_input(pick),
                f"watchlist pick: {pick['title']} ({pick['year']})")

    if content_type == "vardagsmiddag":
        ingredient = seasonal_ingredients.next_pick(today)
        return (seasonal_ingredients.build_local_input(ingredient),
                f"seasonal ingredient: {ingredient}")

    stories = local_context.recent_local_stories(conn, town_id)
    local_input = local_context.build_local_input(stories)
    return local_input, f"{len(stories)} lokala poster"


def _existing_corpus(conn, town_id: str, source_type: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT body FROM stories
             WHERE town_id = %s AND source_type = %s
               AND published_at >= now() - make_interval(days => %s)
            """,
            (town_id, source_type, ORIGINALITY_LOOKBACK_DAYS),
        )
        return [row[0] for row in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till stories "
                         "(gör ett riktigt AI-anrop -- kostar samma som en publicering)")
    ap.add_argument("--date", help="åsidosätt dagens datum (YYYY-MM-DD), för test")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    today = (datetime.date.fromisoformat(args.date) if args.date
             else datetime.date.today())
    content_type = content_type_for(today)
    print(f"{today.isoformat()} ({today.strftime('%A')}) -> {content_type}")

    if content_type not in MODULES:
        print(f"  ingen modul kopplad för '{content_type}' ännu -- hoppar över")
        return 0

    write, category = MODULES[content_type]
    slug = f"{content_type}-{today.isoformat()}"

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        local_input, source_desc = _build_local_input(conn, town_id, content_type, today)
        if local_input is None:
            print(f"  inget underlag ({source_desc}) -- hoppar över")
            return 0
        print(f"  underlag: {source_desc}")

        existing_corpus = _existing_corpus(conn, town_id, content_type)

        article = write(local_input, existing_corpus, cfg=cfg)
        if article is None:
            print("  generering gav inget godkänt resultat (budgettak, "
                  "originalitet, eller avkapad text) -- hoppar över publicering idag")
            return 0

        words = len(article.body.split())
        print(f"  \"{article.title}\" ({words} ord)")

        if args.dry_run:
            print("\n" + "=" * 70)
            print(article.body)
            print("=" * 70)
            print("\n(dry-run -- INGET skrevs till stories, ingen bild genererad)")
            return 0

        # generate_illustration() returnerar None vid fel (saknad nyckel, nätverk,
        # leverantörsfel) i stället för att kasta -- image_path förblir då NULL och
        # sidan faller tillbaka på /og/{slug}.png som hero, samma som för content
        # utan illustration. En misslyckad bild ska aldrig blockera publiceringen.
        image_path = None
        saved = generate_illustration(illustration_theme(article), slug)
        if saved is not None:
            image_path = "/" + str(saved.relative_to(PUBLIC_DIR)).replace("\\", "/")
            print(f"  illustration: {image_path}")

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, occurs_at,
                     generated_by, verified, published_at, byline, image_path, rating)
                VALUES (%s,%s,%s,%s,%s, now(), %s, true, now(), 'AI-genererad', %s, %s)
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    published_at = now(),
                    image_path = EXCLUDED.image_path,
                    rating = EXCLUDED.rating
                """,
                (town_id, article.title, slug, article.body, content_type,
                 f"ai:{DEFAULT_MODEL}", image_path, article.rating),
            )
        conn.commit()

    print(f"  publicerad: {slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
