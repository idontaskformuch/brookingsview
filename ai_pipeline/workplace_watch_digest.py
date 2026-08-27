"""Worker Pulse / Workplace Watch -- månatlig arbetsgivar-review-digest.

Town-generic (se site/src/pages/workplace-watch) -- körs mot valfri config
vars data_sources.workplace_watch är enabled (Moreno Valley, Broomfield).
Sökfrågorna/underlagstexten byggs av cfg["display_name"]/cfg["state"], inte
hårdkodat -- fixat 2026-08-26 (se NEEDS-HUMAN-REVIEW.md "Broomfield launch"),
tidigare sökte modulen alltid efter "Moreno Valley" oavsett vilken --config
som gavs. Glassdoor och
Indeed har ingen publik API och blockerar aktivt skrapning (robots.txt +
anti-bot), så det här skriptet skrapar INGET direkt -- det söker via Brave
Search (ai_pipeline/search_client.py) och låter AI:n väva ihop en
PARAFRASERAD, förbehållen sammanfattning av träfftexterna ("reviews
mention..."), aldrig ett verbatim citat. Se guardrails.validate_employer_
hedging() för den regeln -- namngivna företag är på riktigt här, till
skillnad från recept/evenemang.

Ett stjärnbetyg (overall_rating) extraheras bara om det uttryckligen står i
en sök-snippet -- gissas det inte fram står fältet som NULL ("rating
pending" i UI:t). Hellre ingen siffra än en påhittad, samma princip som
resten av pipelinen.

Skriver till TVÅ tabeller per arbetsgivare och månad: `stories` (den
narrativa texten, får ett vanligt /s/<slug>-permalink precis som alla andra
digests) och `employer_ratings` (de strukturerade fälten -- betyg, trend,
tema-sammanfattning -- som /workplace-watch:s jämförelsetabell och startsido-
widgeten läser direkt, ingen AI-inferens i frontend).

IDEMPOTENS: sluggen är deterministisk per arbetsgivare och månad
("workplace-watch-amazon-2026-08"), och underlaget hashas på sök-
träffarnas titel+beskrivning -- samma mönster som sdsu_weekly_digest.py.
Oförändrade sökresultat sedan förra körningen kostar inget nytt AI-anrop.

Körning:
    python -m ai_pipeline.workplace_watch_digest --config configs/moreno_valley_ca.json
    python -m ai_pipeline.workplace_watch_digest --config configs/moreno_valley_ca.json --force
    python -m ai_pipeline.workplace_watch_digest --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails, search_client
from ai_pipeline.publish import prefix_town_name
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "workplace_watch_digest"

# under så här många ord är resultatet inte en riktig sammanfattning (kortare
# format än university-digestens 60 -- spec:en efterfrågar 3-5 meningar)
MIN_WORDS = 30

_RATING_RE = re.compile(r"(\d\.\d)\s*(?:out of 5|/\s*5|stars)", re.IGNORECASE)


def extract_rating(snippet_text: str) -> float | None:
    """Regex-plockar ett stjärnbetyg UR sök-snippet-texten om det uttryckligen
    står där. Ingen träff -> None (visas som "rating pending"), aldrig en
    gissning -- se moduldocstring."""
    m = _RATING_RE.search(snippet_text)
    if not m:
        return None
    try:
        val = float(m.group(1))
    except ValueError:
        return None
    return val if 0 <= val <= 5 else None


def gather_employers(conn, town_id: str) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, slug, name, facility_type FROM employers "
            "WHERE town_id = %s ORDER BY name",
            (town_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def previous_rating(conn, town_id: str, employer_id: int, period) -> float | None:
    prev_period = (period.replace(day=1) - timedelta(days=1)).replace(day=1)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT overall_rating FROM employer_ratings "
            "WHERE town_id=%s AND employer_id=%s AND period=%s",
            (town_id, employer_id, prev_period),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def results_hash(results: list[dict]) -> str:
    payload = "|".join(sorted(f"{r['title']}::{r['description']}" for r in results))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_grounding_text(employer_name: str, results: list[dict], cfg: dict) -> str:
    city, state = cfg["display_name"], cfg["state"]
    if not results:
        return f"No search results found for {employer_name} {city} reviews this month."
    parts = [f"SEARCH RESULTS FOR: {employer_name} ({city}, {state}) reviews"]
    for r in results:
        line = f"- {r['title']}: {r['description']}" if r.get("description") else f"- {r['title']}"
        parts.append(line)
    return "\n".join(parts)


def build_prompt(cfg: dict, employer_name: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- WORKER PULSE MONTHLY EMPLOYER DIGEST:
You are writing a short (3-5 sentence) paragraph summarizing recurring THEMES
in recent online reviews about {employer_name}'s {cfg["display_name"]} facility,
based on the search result snippets below.

HARD RULES SPECIFIC TO THIS FORMAT (in addition to the rules above):
- {employer_name} is a REAL, NAMED company. Every claim about it must be
  attributed, not asserted as fact: "reviews mention...", "employees
  describe...", "several reviews note...". Never write a bare claim like
  "the facility is understaffed" -- always hedge it as what reviews say.
- NEVER quote review text verbatim, even short phrases. Paraphrase only.
- If the snippets contain a specific star rating, you may mention it, but do
  NOT invent or estimate a rating that isn't explicitly present.
- If the snippets contain little or no substantive review content, say so
  plainly rather than padding with generic filler.

Return ONLY the paragraph. No title, no preamble."""


def template_fallback(employer_name: str, results: list[dict]) -> str:
    """Ren, korrekt fallback när AI-vägen inte håller. Torr men sann."""
    if not results:
        return f"No summarized review update is available for {employer_name} this month."
    return (f"No AI-generated summary passed review this month for {employer_name}. "
            f"Check back next month for an updated Worker Pulse summary.")


def generate(employer_name: str, results: list[dict], cfg: dict, client=None) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified)."""
    src = build_grounding_text(employer_name, results, cfg)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(employer_name, results), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(employer_name, results), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, employer_name)

    def call(extra: str = "") -> str:
        msg = safe_create(
            client,
            model=model, max_tokens=500, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    try:
        text = call()
        fact_result = guardrails.validate(text, src, cfg)
        hedge_result = guardrails.validate_employer_hedging(text, [employer_name])

        if not (fact_result.passed and hedge_result.passed):
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or stated a claim about the company as settled fact "
                        "instead of attributing it to reviews. Rewrite using ONLY facts "
                        "from the SOURCE DATA, and hedge every claim about the company "
                        "as something reviews/employees say, not as fact.")
            fact_result = guardrails.validate(text, src, cfg)
            hedge_result = guardrails.validate_employer_hedging(text, [employer_name])
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(employer_name, results), "template_fallback", True

    if fact_result.passed and hedge_result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not fact_result.passed else ("hedging" if not hedge_result.passed else "too short")
    print(f"  faller tillbaka på mall ({reason})")
    for v in (fact_result.violations + hedge_result.violations)[:5]:
        print(f"    - {v}")
    return template_fallback(employer_name, results), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true",
                    help="generera om även när underlaget är oförändrat")
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till DB "
                         "(gör riktiga sök-/AI-anrop -- kostar samma som en publicering)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    tz = ZoneInfo(cfg.get("timezone", "America/Los_Angeles"))

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    period = datetime.now(tz).replace(day=1, hour=0, minute=0, second=0, microsecond=0).date()
    period_label = period.strftime("%B %Y")
    print(f"Worker Pulse -- {period_label} ({town_id})")

    with psycopg.connect(database_url) as conn:
        employers = gather_employers(conn, town_id)
        if not employers:
            print("  inga employers registrerade -- kör 'python -m scripts.seed_employers "
                  f"{town_id}' först")
            return 0

        for employer in employers:
            slug = f"workplace-watch-{employer['slug']}-{period.strftime('%Y-%m')}"
            print(f"\n{employer['name']} ({slug})")

            try:
                results = (
                    search_client.brave_search(
                        f"{employer['name']} {cfg['display_name']} Glassdoor reviews {period_label}")
                    + search_client.brave_search(
                        f"{employer['name']} {cfg['display_name']} Indeed reviews {period_label}")
                )
            except search_client.SearchUnavailable as exc:
                print(f"  sök misslyckades ({exc}) -- hoppar över den här arbetsgivaren")
                continue

            new_hash = results_hash(results)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                    (town_id, slug))
                row = cur.fetchone()

            if row and row[0] == new_hash and not args.force and not args.dry_run:
                print("  underlaget oförändrat -- hoppar över (inget AI-anrop)")
                continue

            text, generated_by, verified = generate(employer["name"], results, cfg)
            rating = extract_rating(build_grounding_text(employer["name"], results, cfg))
            prev = previous_rating(conn, town_id, employer["id"], period)
            delta = (rating - prev) if (rating is not None and prev is not None) else None
            title = prefix_town_name(f"Worker Pulse: {employer['name']} — {period_label}", cfg["display_name"])

            if args.dry_run:
                print("\n" + "=" * 70)
                print(f"TITEL: {title}")
                print(f"RATING: {rating}  DELTA: {delta}  GENERATED_BY: {generated_by}  "
                      f"VERIFIED: {verified}  {len(text.split())} ord")
                print("=" * 70)
                print(text)
                print("=" * 70)
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO stories
                        (town_id, title, slug, body, source_type, occurs_at,
                         generated_by, verified, content_hash, published_at, byline)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),'AI-generated')
                    ON CONFLICT (town_id, slug) DO UPDATE SET
                        title = EXCLUDED.title,
                        body = EXCLUDED.body,
                        generated_by = EXCLUDED.generated_by,
                        verified = EXCLUDED.verified,
                        content_hash = EXCLUDED.content_hash,
                        published_at = now()
                    """,
                    (town_id, title, slug, text, SOURCE_TYPE, period,
                     generated_by, verified, new_hash),
                )
                cur.execute(
                    """
                    INSERT INTO employer_ratings
                        (town_id, employer_id, period, overall_rating, rating_source_note,
                         theme_summary, rating_delta_vs_last_month, content_hash)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (town_id, employer_id, period) DO UPDATE SET
                        overall_rating = EXCLUDED.overall_rating,
                        rating_source_note = EXCLUDED.rating_source_note,
                        theme_summary = EXCLUDED.theme_summary,
                        rating_delta_vs_last_month = EXCLUDED.rating_delta_vs_last_month,
                        content_hash = EXCLUDED.content_hash
                    """,
                    (town_id, employer["id"], period, rating,
                     "based on recent Glassdoor/Indeed search results" if rating is not None else None,
                     text, delta, new_hash),
                )
            conn.commit()

            action = "uppdaterad" if row else "skapad"
            print(f"  {action}: {generated_by}, rating={rating}, delta={delta}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
