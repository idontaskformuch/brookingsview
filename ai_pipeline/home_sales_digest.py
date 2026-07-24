"""Home sales digest -- "Moreno Valley home sales: what sold in <Month Year>".

EN AI-skriven artikel per kalendermånad som sammanfattar husförsäljningarna i
property_sales, i stället för en story per rad (se lib/db.ts/home-sales.astro
och punkt 4 i publish.py:s moduldocstring för varför en rad-per-story hade
varit exakt den "scaled content"-signalen som redan flaggades där). Det här är
den "hittas via Google"-artikeln (alternativ B) som kompletterar
/home-sales-tabellen (alternativ A, redan byggd -- tabellen läser property_sales
direkt, ingen story).

CADENCE: property_sales fylls på manuellt/kvartalsvis -- rivcoacr.org blockerar
AI-agenter explicit, så ingen scraper hämtar datan automatiskt (se
scrapers/parsers/rivco_property_sales_v1.py). Det här skriptet körs därför inte
mot "förra månaden" utan itererar över VARJE kalendermånad som redan har rader i
property_sales och skapar/uppdaterar en digest per månad. En körning efter en ny
kvartalsfil täcker då in alla nytillkomna eller ändrade månader på en gång,
inklusive historisk backfyllnad första gången skriptet körs mot 2024-2025-datan.

IDEMPOTENS OCH KOSTNAD: sluggen är deterministisk per månad
("home-sales-digest-2026-06"), och underlaget hashas på VILKA sale-id:n som
ingår -- samma mönster som weekly.py. En månad vars underlag inte ändrats sedan
förra körningen kostar inget nytt AI-anrop.

Delar bas-röst och hårda regler med format_prompt.build_system_prompt (inga
namn, bara källfakta, ingen åsikt) -- se den modulen för fulla reglerna. Extra
regel här: aldrig framställ siffrorna som köp-/investeringsråd, bara rapportera
vad som faktiskt registrerats.

Körning:
    python -m ai_pipeline.home_sales_digest --config configs/moreno_valley_ca.json
    python -m ai_pipeline.home_sales_digest --config configs/moreno_valley_ca.json --force
    python -m ai_pipeline.home_sales_digest --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
from calendar import month_name
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from ai_pipeline.format_prompt import build_system_prompt, _spent_this_month, _record_spend

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

_USD_PER_INPUT_TOKEN = 3.0 / 1_000_000
_USD_PER_OUTPUT_TOKEN = 15.0 / 1_000_000

SOURCE_TYPE = "home_sales_digest"

# under så här många ord är resultatet inte en riktig sammanfattning
MIN_WORDS = 150

# hur många av de dyraste försäljningarna som lyfts fram som konkreta exempel
# -- ger modellen namngivna fakta att skriva mot i stället för bara aggregat,
# samma "extraktivt, inte påhittat"-princip som resten av pipelinen.
TOP_N_SALES = 5


def _fmt_price(value) -> str:
    if value is None:
        return "unknown price"
    return f"${value:,.0f}"


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def months_with_sales(conn, town_id: str) -> list[tuple[int, int]]:
    """Varje (år, månad) som redan har minst en försäljning i property_sales."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT extract(year FROM sale_date)::int, extract(month FROM sale_date)::int
              FROM property_sales
             WHERE town_id = %s AND sale_date IS NOT NULL
             ORDER BY 1, 2
            """,
            (town_id,),
        )
        return [(int(y), int(m)) for y, m in cur.fetchall()]


def collect_month(conn, town_id: str, year: int, month: int) -> list[dict]:
    start, end = month_bounds(year, month)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, address, sale_price, sale_date, raw_data
              FROM property_sales
             WHERE town_id = %s AND sale_date >= %s AND sale_date < %s
             ORDER BY sale_price DESC NULLS LAST
            """,
            (town_id, start, end),
        )
        return [dict(r) for r in cur.fetchall()]


def content_hash(sales: list[dict]) -> str:
    ids = sorted(str(s["id"]) for s in sales)
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


def _postal_code(sale: dict) -> str | None:
    raw = sale.get("raw_data") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    code = raw.get("PostalCd")
    return str(code).strip() or None if code else None


def compute_stats(sales: list[dict]) -> dict:
    priced = [s["sale_price"] for s in sales if s.get("sale_price") is not None]
    by_zip: dict[str, int] = {}
    for s in sales:
        zip_code = _postal_code(s)
        if zip_code:
            by_zip[zip_code] = by_zip.get(zip_code, 0) + 1

    return {
        "count": len(sales),
        "median_price": statistics.median(priced) if priced else None,
        "min_price": min(priced) if priced else None,
        "max_price": max(priced) if priced else None,
        "priced_count": len(priced),
        "by_zip": dict(sorted(by_zip.items(), key=lambda kv: -kv[1])),
        "top_sales": sales[:TOP_N_SALES],
    }


def source_text(stats: dict, label: str) -> str:
    """Platta ut underlaget till den text AI:n (och guardrails) arbetar mot.

    Bara aggregat och de dyraste försäljningarna skickas, inte hela månaden --
    en aktiv månad kan ha hundratals rader, och modellen ska skriva en
    sammanfattning, inte återge en tabell.

    SOURCE-raden nedan finns för att guardrails.validate()'s entitetskoll ska
    kunna verifiera den -- prompten ber modellen "close by noting the data
    source", och den skriver då korrekt och sant ut "Riverside County
    Assessor('s ...)". Utan den här raden fanns den frasen ingenstans i
    källtexten, så en helt korrekt mening föll ändå tillbaka på mallen som om
    den vore påhittad (verifierat: 3 av 21 månader föll på exakt detta innan
    raden lades till)."""
    parts = [
        f"MONTH: {label}",
        "SOURCE: Riverside County Assessor's Property Sales Report",
        f"TOTAL RECORDED SALES: {stats['count']}",
    ]

    if stats["median_price"] is not None:
        parts.append(f"MEDIAN SALE PRICE: {_fmt_price(stats['median_price'])}")
        parts.append(
            f"PRICE RANGE: {_fmt_price(stats['min_price'])} to {_fmt_price(stats['max_price'])} "
            f"({stats['priced_count']} of {stats['count']} sales had a recorded price)"
        )

    if stats["by_zip"]:
        parts.append("\nSALES BY ZIP CODE:")
        for zip_code, count in stats["by_zip"].items():
            parts.append(f"- {zip_code}: {count} sale(s)")

    if stats["top_sales"]:
        parts.append(f"\nTOP {len(stats['top_sales'])} SALES BY PRICE THIS MONTH:")
        for s in stats["top_sales"]:
            when = s["sale_date"].isoformat() if s.get("sale_date") else "unknown date"
            parts.append(f"- {s.get('address') or 'address on file'}, "
                        f"{_fmt_price(s.get('sale_price'))}, recorded {when}")

    return "\n".join(parts)


def build_prompt(cfg: dict, label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- THE HOME SALES DIGEST:
You are now writing a monthly home sales digest for {label}: ONE article of
250-400 words summarizing recorded home sales from Riverside County's public
assessor data. This replaces the "keep it short" instruction above.

STRUCTURE:
- Open with the headline number: how many sales recorded and the median price.
- Use the ZIP code breakdown to say where activity concentrated, if it's
  informative (skip it if one ZIP dominates so heavily there's nothing to say).
- Reference 2-3 of the top sales by address and price as concrete examples,
  not the full list.
- Close by noting the data source and its lag (county records, updated
  quarterly) so readers understand this is a look back, not real-time.

HARD RULE SPECIFIC TO THIS FORMAT:
- This is a report of what was recorded, never investment or buying advice.
  Do not suggest whether it's a good time to buy or sell, do not speculate on
  future prices, do not use words like "should" about a reader's decisions.

Return ONLY the article text. No preamble, no title."""


def template_fallback(stats: dict, label: str, cfg: dict) -> str:
    """Ren, korrekt sammanfattning när AI-vägen inte håller. Torr men sann."""
    town = cfg["display_name"]
    lines = [f"Riverside County recorded {stats['count']} home sale(s) in {town} for {label}."]
    if stats["median_price"] is not None:
        lines.append(f"The median recorded sale price was {_fmt_price(stats['median_price'])}, "
                     f"ranging from {_fmt_price(stats['min_price'])} to {_fmt_price(stats['max_price'])}.")
    if stats["by_zip"]:
        lines.append("\nSales by ZIP code:")
        lines += [f"{z}: {c}" for z, c in stats["by_zip"].items()]
    if stats["top_sales"]:
        lines.append("\nHighest-priced recorded sales this month:")
        lines += [f"{s.get('address') or 'address on file'}, {_fmt_price(s.get('sale_price'))}"
                  for s in stats["top_sales"]]
    lines.append("\nData is from Riverside County's public assessor Property Sales Report, "
                 "updated quarterly, not in real time.")
    return "\n".join(lines)


def generate(stats: dict, label: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified)."""
    src = source_text(stats, label)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(stats, label, cfg), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(stats, label, cfg), "template_fallback", True
        client = anthropic.Anthropic()

    model = ai_cfg.get("model", "claude-sonnet-5")
    system = build_prompt(cfg, label)

    def call(extra: str = "") -> str:
        msg = client.messages.create(
            model=model, max_tokens=1200, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * _USD_PER_INPUT_TOKEN
                      + msg.usage.output_tokens * _USD_PER_OUTPUT_TOKEN)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    text = call()
    result = guardrails.validate(text, src, cfg)

    if not result.passed:
        text = call("\n\nYour previous attempt included details not found in the "
                    "source, or framed the numbers as advice. Rewrite using ONLY "
                    "facts explicitly present in the SOURCE DATA, and report only.")
        result = guardrails.validate(text, src, cfg)

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not result.passed:
        for v in result.violations[:5]:
            print(f"    - {v}")
    return template_fallback(stats, label, cfg), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true",
                    help="generera om alla månader även när underlaget är oförändrat")
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till stories "
                         "(gör riktiga AI-anrop för ändrade månader -- kostar samma som publicering)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        months = months_with_sales(conn, town_id)
        if not months:
            print("  ingen property_sales-data för den här orten -- inget att sammanfatta")
            return 0

        created = updated = unchanged = 0
        for year, month in months:
            label = f"{month_name[month]} {year}"
            slug = f"home-sales-digest-{year}-{month:02d}"

            sales = collect_month(conn, town_id, year, month)
            new_hash = content_hash(sales)

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                    (town_id, slug))
                row = cur.fetchone()

            if row and row[0] == new_hash and not args.force and not args.dry_run:
                unchanged += 1
                continue

            stats = compute_stats(sales)
            text, generated_by, verified = generate(stats, label, cfg)
            title = f"{cfg['display_name']} home sales: what sold in {label}"

            if args.dry_run:
                print("\n" + "=" * 70)
                print(f"SLUG: {slug}")
                print(f"TITEL: {title}")
                print(f"GENERATED_BY: {generated_by}  |  {len(text.split())} ord")
                print("=" * 70)
                print(text)
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO stories
                        (town_id, title, slug, body, source_type, occurs_at,
                         generated_by, verified, published_at, byline, content_hash)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now(),'AI-genererad',%s)
                    ON CONFLICT (town_id, slug) DO UPDATE SET
                        title = EXCLUDED.title,
                        body = EXCLUDED.body,
                        generated_by = EXCLUDED.generated_by,
                        verified = EXCLUDED.verified,
                        published_at = now(),
                        content_hash = EXCLUDED.content_hash
                    """,
                    (town_id, title, slug, text, SOURCE_TYPE,
                     datetime(year, month, 1, tzinfo=timezone.utc),
                     generated_by, verified, new_hash),
                )
            conn.commit()
            if row:
                updated += 1
                print(f"  {slug}: uppdaterad ({len(sales)} försäljningar, {generated_by})")
            else:
                created += 1
                print(f"  {slug}: skapad ({len(sales)} försäljningar, {generated_by})")

        if not args.dry_run:
            print(f"\nTotalt: {created} nya, {updated} uppdaterade, {unchanged} oförändrade")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
