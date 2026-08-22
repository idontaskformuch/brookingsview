"""Veckovis lokal skolsport-notis -- "<Town> school sports notes: week of
<date range>", ett komplement till sports_weekly_digest.py:s REGIONALA
proffs-/MiLB-sammanfattning (Angels/Dodgers/66ers), inte en ersättning.

FAS 2-BAKGRUND: research hittade INGEN verifierad, öppet skrapbar källa för
riktiga lokala matchresultat/scheman på high school-nivå -- varken MaxPreps
eller CIF-SS har en dokumenterad öppen API/feed, och att bygga en scraper mot
en overifierad, sannolikt bot-skyddad kommersiell källa hade brutit den här
kodbasens egen liveverifieringsdisciplin (jämför MLB Stats API/Caltrans
QuickMap/Adzuna, som alla HAR en sådan verifieringsanteckning i sin config).
Se NEEDS-HUMAN-REVIEW.md för den öppna uppföljningen (någon behöver kolla om
skoldistriktet/CIF-SS erbjuder ett konto-baserat flöde).

DÄREMOT finns redan en verifierad, live källa som IBLAND nämner skolsport i
förbifarten: skoldistriktets egna allmänna meddelandeflöde (se
scrapers/parsers/school_alerts_v1.py/db/migrations/010) -- "Homecoming game
Friday", "Congratulations to the varsity volleyball team", etc. blandat med
helt orelaterade notiser. Det här skriptet filtrerar den veckans poster på
sportnyckelord (SPORTS_KEYWORDS, samma deterministiska
nyckelordsmatchning-i-stället-för-AI-klassificering-princip som
school_alerts_v1.py:s is_closure) och låter modellen ENDAST sammanfatta de
filtrerade posternas egen text -- aldrig hitta på ett resultat eller schema
som inte står där. Om ingen post matchar en given vecka skapas ingen artikel
(se main()) -- hellre tyst än en tom/påhittad sammanfattning, husregel 4.

Delar mönster (veckogränser, content_hash-idempotens, guardrails,
mall-fallback) med sports_weekly_digest.py -- se den modulen för det fulla
resonemanget bakom varje del, upprepas inte här.

Körning:
    python -m ai_pipeline.local_sports_weekly_digest --config configs/moreno_valley_ca.json
    python -m ai_pipeline.local_sports_weekly_digest --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)
from ai_pipeline.sports_weekly_digest import previous_week_bounds

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "local_sports_digest"
MIN_WORDS = 30  # kortare tak än regional_sports -- underlaget är oftast bara ett par notiser

_SPORTS_KEYWORDS = [
    "football", "basketball", "baseball", "softball", "soccer", "volleyball",
    "wrestling", "track and field", "cross country", "swim", "tennis", "golf",
    "water polo", "cheer", "homecoming game", "varsity", "junior varsity", " jv ",
    "playoff", "championship game", "league title", "athletic", "athletics",
    "tournament", "the team went", "sports banquet",
]
_SPORTS_RE = re.compile("|".join(re.escape(k) for k in _SPORTS_KEYWORDS), re.IGNORECASE)


def gather_sports_mentions(conn, town_id: str, start_date, end_date) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, title, message, posted_at
              FROM school_alerts
             WHERE town_id = %s
               AND posted_at::date BETWEEN %s AND %s
               AND is_closure = FALSE
             ORDER BY posted_at
            """,
            (town_id, start_date, end_date),
        )
        rows = [dict(r) for r in cur.fetchall()]
    return [r for r in rows if _SPORTS_RE.search(f"{r['title'] or ''} {r['message']}")]


def content_hash(mentions: list[dict]) -> str:
    ids = sorted(str(m["id"]) for m in mentions)
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


def build_grounding_text(mentions: list[dict], label: str) -> str:
    parts = [f"WEEK: {label}",
             "SOURCE: the school district's own general announcement feed "
             "(not a dedicated sports schedule/results service) -- quote or "
             "closely paraphrase, never invent a score or date not present."]
    for m in mentions:
        when = m["posted_at"].date().isoformat() if hasattr(m["posted_at"], "date") else str(m["posted_at"])
        heading = f" ({m['title']})" if m["title"] else ""
        parts.append(f"\n- [{when}]{heading}: {m['message']}")
    return "\n".join(parts)


def build_prompt(cfg: dict, label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- LOCAL SCHOOL SPORTS NOTES, week of {label}:
The source below is the school district's own general announcement feed --
NOT a dedicated sports results/schedule service. It only mentions sports in
passing among other district news. Write a SHORT note (2-4 sentences) that
plainly reports what the district itself said, hedged appropriately
("the district's newsletter noted...", "according to the district's
announcements..."). Never state a final score, standing, or date that is
not explicitly present in the source text. If the source only has vague
mentions (no scores, no explicit results), say so plainly rather than
implying more precision than the source has.

Return ONLY the note text. No preamble, no title."""


def template_fallback(mentions: list[dict], label: str) -> str:
    parts = [f"From the school district's announcements this week ({label}):"]
    for m in mentions:
        heading = f"{m['title']}: " if m["title"] else ""
        parts.append(f"- {heading}{m['message']}")
    return "\n".join(parts)


def generate(mentions: list[dict], label: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    src = build_grounding_text(mentions, label)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(mentions, label), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(mentions, label), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, label)

    def call(extra: str = "") -> str:
        msg = safe_create(
            client,
            model=model, max_tokens=400, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    try:
        text = call()
        result = guardrails.validate(text, src, cfg)
        if not result.passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or stated a result/score/date not explicitly present. "
                        "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
            result = guardrails.validate(text, src, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(mentions, label), "template_fallback", True

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    return template_fallback(mentions, label), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    start, end, slug, label = previous_week_bounds()
    slug = slug.replace("sports-digest-", "local-sports-notes-")
    print(f"Vecka {label}  ({slug})")

    with psycopg.connect(database_url) as conn:
        mentions = gather_sports_mentions(conn, town_id, start, end)
        print(f"  underlag: {len(mentions)} sportrelaterade notiser i skoldistriktets flöde")

        if not mentions:
            print("  inga sportrelaterade notiser den här veckan -- ingen story skapas")
            return 0

        new_hash = content_hash(mentions)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                (town_id, slug))
            row = cur.fetchone()

        if row and row[0] == new_hash and not args.force and not args.dry_run:
            print("  underlaget oförändrat -- hoppar över (inget AI-anrop)")
            return 0

        text, generated_by, verified = generate(mentions, label, cfg)
        title = f"{cfg['display_name']} school sports notes: week of {label}"

        if args.dry_run:
            print("\n" + "=" * 70)
            print(f"TITEL: {title}")
            print(f"GENERATED_BY: {generated_by}  |  VERIFIED: {verified}")
            print("=" * 70)
            print(text)
            print("=" * 70)
            print("\n(dry-run -- INGET skrevs till stories)")
            return 0

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, occurs_at,
                     generated_by, verified, content_hash, published_at, byline)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),'AI-genererad')
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    generated_by = EXCLUDED.generated_by,
                    verified = EXCLUDED.verified,
                    content_hash = EXCLUDED.content_hash,
                    published_at = now()
                """,
                (town_id, title, slug, text, SOURCE_TYPE,
                 datetime(end.year, end.month, end.day, tzinfo=timezone.utc),
                 generated_by, verified, new_hash))
        conn.commit()

        action = "uppdaterad" if row else "skapad"
        print(f"  {action}: {len(text.split())} ord, {generated_by}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
