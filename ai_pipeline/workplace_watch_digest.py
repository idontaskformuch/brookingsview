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

Skriver till TRE tabeller per arbetsgivare och månad: `stories` (den
narrativa texten, får ett vanligt /s/<slug>-permalink precis som alla andra
digests), `employer_ratings` (de strukturerade fälten -- betyg, trend,
tema-sammanfattning) och `employer_ratings`s syskon `employer_job_stats`
(Fas 4a, hiring-lagret -- se db/migrations/039_employer_job_stats.sql): antal
Adzuna-annonser (`jobs`, redan levande, se scrapers/parsers/jobs_v1.py) som
matchar arbetsgivarens namn+aliases, sedda de senaste LOOKBACK_DAYS dagarna.
Namnmatchningen återanvänder ai_pipeline/guardrails.py:s `_norm()` (samma
possessiv-strippande normaliserare som redan fixades för "Deckers Brands'"/
"Skechers U.S.A.'s" i den ursprungliga Worker Pulse-commiten) -- ingen ny
normaliserare skriven. Matchningen är EXAKT efter normalisering, aldrig en
substräng: `jobs.company` är ofta ett juridiskt dotterbolagsnamn ("Amazon.com
Services LLC", inte "Amazon"), så aliases-arrayen på employers är den ärliga
vägen dit -- en substräng-matchning på ett kort namn ("Ball" i Ball
Corporation) riskerar falska träffar mot orelaterade bolag. Alla tre
tabellerna läses direkt av /workplace-watch:s jämförelsetabell och startsido-
widgeten, ingen AI-inferens i frontend.

VIKTIGT (verifierat live 2026-09-05, se scripts/seed_employer_aliases.py):
av de 8 idag spårade arbetsgivarna har bara Amazon några matchande Adzuna-
annonser alls. De övriga sju visar ärligt 0 -- inte en matchningsbugg, en
verklig avsaknad av Adzuna-täckning för just de bolagen just nu. Att bredda
VILKA arbetsgivare som spåras (så att fler visar riktig volym) är en egen,
framtida research-uppgift, samma sorts arbete som Fas 3:s källjakt -- inte
del av det här bygget.

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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails, search_client
from ai_pipeline.guardrails import normalize_name
from validation import pre_publish_check
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

# Fas 4a (hiring layer): `jobs` is append-only (scrapers/parsers/jobs_v1.py --
# ON CONFLICT DO NOTHING, a row's presence only ever means "seen at least
# once", never "still open today"). A recency window on posted_at is the
# honest, disclosed approximation of "openings now" -- same 30-day window
# already established for Legistar's own listing-then-per-item-fetch pattern
# (scrapers/parsers/legistar_v1.py), reused here rather than inventing a new
# number.
LOOKBACK_DAYS = 30


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
            "SELECT id, slug, name, facility_type, aliases FROM employers "
            "WHERE town_id = %s ORDER BY name",
            (town_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def count_matching_postings(conn, town_id: str, employer: dict) -> int:
    """Antal Adzuna-annonser (`jobs.company`) som exakt matchar denna
    arbetsgivares namn eller någon av dess aliases, EFTER normalisering
    (guardrails.normalize_name() -- samma possessiv-strippande normaliserare
    som redan fixades för "Deckers Brands'"/"Skechers U.S.A.'s", ingen ny
    skriven här). Exakt match, aldrig substräng -- se
    db/migrations/039_employer_job_stats.sql för varför en kort arbetsgivare
    ("Ball" i Ball Corporation) annars riskerar falska träffar. Begränsat
    till LOOKBACK_DAYS för att approximera "öppen nu" ärligt (se modulens
    egen kommentar ovan om varför `jobs` inte kan svara på det direkt)."""
    match_names = {normalize_name(employer["name"])}
    match_names |= {normalize_name(a) for a in (employer.get("aliases") or [])}

    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT company FROM jobs WHERE town_id=%s AND posted_at >= %s",
            (town_id, cutoff),
        )
        return sum(
            1 for (company,) in cur.fetchall()
            if company and normalize_name(company) in match_names
        )


def previous_posting_count(conn, town_id: str, employer_id: int, period) -> int | None:
    prev_period = (period.replace(day=1) - timedelta(days=1)).replace(day=1)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT posting_count FROM employer_job_stats "
            "WHERE town_id=%s AND employer_id=%s AND period=%s",
            (town_id, employer_id, prev_period),
        )
        row = cur.fetchone()
    return int(row[0]) if row else None


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

    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        fact_result = guardrails.validate(candidate, src, cfg)
        hedge_result = guardrails.validate_employer_hedging(candidate, [employer_name])
        violations = fact_result.violations + hedge_result.violations
        if not violations:
            violations = pre_publish_check(
                candidate, source_records=results, cfg=cfg, content_type=SOURCE_TYPE,
            ).violations
        return not violations, violations

    try:
        text = call()
        passed, violations = _checks_pass(text)

        if not passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or stated a claim about the company as settled fact "
                        "instead of attributing it to reviews. Rewrite using ONLY facts "
                        "from the SOURCE DATA, and hedge every claim about the company "
                        "as something reviews/employees say, not as fact.")
            passed, violations = _checks_pass(text)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(employer_name, results), "template_fallback", True

    if passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    for v in violations[:5]:
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

            # Fas 4a (hiring layer): körs OVILLKORLIGT, INNAN "underlaget
            # oförändrat"-hoppet nedan -- annonsvolym ändras oberoende av
            # review-sök-underlaget, så en oförändrad review-digest får
            # aldrig hindra hiring-siffrorna från att uppdateras. Ren
            # SQL-räkning, inget AI-anrop, så det kostar inget att alltid
            # köra den, även vid upprepade körningar samma månad.
            posting_count = count_matching_postings(conn, town_id, employer)
            prev_postings = previous_posting_count(conn, town_id, employer["id"], period)
            postings_delta = (posting_count - prev_postings) if prev_postings is not None else None
            print(f"  hiring: {posting_count} listing(s) observed (last {LOOKBACK_DAYS}d)"
                  + (f", {postings_delta:+d} vs last month" if postings_delta is not None else ""))
            if not args.dry_run:
                stats_hash = hashlib.sha256(f"{town_id}|{employer['id']}|{period}|{posting_count}"
                                             .encode("utf-8")).hexdigest()
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO employer_job_stats
                            (town_id, employer_id, period, posting_count, content_hash)
                        VALUES (%s,%s,%s,%s,%s)
                        ON CONFLICT (town_id, employer_id, period) DO UPDATE SET
                            posting_count = EXCLUDED.posting_count,
                            content_hash = EXCLUDED.content_hash
                        """,
                        (town_id, employer["id"], period, posting_count, stats_hash),
                    )
                conn.commit()

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
            # AdSense remediation Phase B2: no town-name prefix -- see
            # ai_pipeline/daily_content.py's own comment on why.
            title = f"Worker Pulse: {employer['name']} — {period_label}"

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
