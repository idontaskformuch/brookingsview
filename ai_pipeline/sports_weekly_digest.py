"""Veckovis sportsammanfattning -- "<Town> sports: week of <date range>".

EN AI-skriven artikel per vecka som sammanfattar avslutade matcher i
regional_sports_games (se scrapers/parsers/regional_sports_v1.py och
db/migrations/009_regional_sports.sql), i stället för en story per match --
samma "scaled content"-resonemang som redan flaggades för husförsäljningar
(se ai_pipeline/home_sales_digest.py) och sport i allmänhet (se
lib/db.ts:getRegionalSports). Det här kompletterar /sports-tabellen (som
redan visar alla matcher rakt av, ingen AI inblandad) med en kort, läsbar
"vad hände i veckan"-text, samma två-nivåers mönster som home-sales.astro
(tabell + digest-artiklar ovanför).

CADENCE: skiljer sig från home_sales_digest.py:s "varje kalendermånad som
har data"-loop. Sport spelas kontinuerligt, så det här skriptet täcker
alltid EN vecka i taget -- den senast AVSLUTADE måndag-söndag-veckan (körs
måndag morgon, se week_bounds() nedan), samma vecka-räkning som
ai_pipeline/weekly.py använder för sin ISO-veckoslug, fast förskjuten en
vecka bakåt eftersom weekly.py sammanfattar innevarande/kommande vecka medan
den här artikeln handlar om resultat som redan är slutgiltiga.

IDEMPOTENS OCH KOSTNAD: sluggen är deterministisk per vecka
("sports-digest-2026-w32"), och underlaget hashas på VILKA matchrader (id:n)
som ingår -- samma mönster som weekly.py/home_sales_digest.py. En vecka utan
förändrat underlag sedan förra körningen kostar inget nytt AI-anrop.

Delar bas-röst och hårda regler med format_prompt.build_system_prompt (inga
namn, bara källfakta, ingen åsikt) -- se den modulen för fulla reglerna.

Körning:
    python -m ai_pipeline.sports_weekly_digest --config configs/moreno_valley_ca.json
    python -m ai_pipeline.sports_weekly_digest --config configs/moreno_valley_ca.json --force
    python -m ai_pipeline.sports_weekly_digest --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
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

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "sports_digest"

# under så här många ord är resultatet inte en riktig sammanfattning
MIN_WORDS = 60


# ---------------------------------------------------------------------------
# 1. VECKOGRÄNSER -- den senast AVSLUTADE måndag-söndag-veckan.
# ---------------------------------------------------------------------------

def previous_week_bounds(today: date | None = None) -> tuple[date, date, str, str]:
    today = today or date.today()
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)
    end = this_monday - timedelta(days=1)
    iso_year, iso_week, _ = start.isocalendar()
    slug = f"sports-digest-{iso_year}-w{iso_week:02d}"
    if start.month == end.month:
        label = f"{start.strftime('%B')} {start.day}–{end.day}"
    else:
        label = f"{start.strftime('%B')} {start.day}–{end.strftime('%B')} {end.day}"
    return start, end, slug, label


# ---------------------------------------------------------------------------
# 2. GATHER STATS (pure data, no AI) -- det här är vad som skyddar mot
#    påhitt: modellen får bara formulera siffror vi redan räknat fram, aldrig
#    hitta på ett resultat själv.
# ---------------------------------------------------------------------------

def gather_team_week_stats(conn, town_id: str, start: date, end: date) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, team_name, league, relevance_tier, opponent_name, home_away,
                   team_score, opponent_score, game_date, status
              FROM regional_sports_games
             WHERE town_id = %s AND game_date BETWEEN %s AND %s AND status = 'final'
             ORDER BY team_name, game_date
            """,
            (town_id, start, end),
        )
        rows = [dict(r) for r in cur.fetchall()]

    by_team: dict[str, dict] = {}
    for r in rows:
        team = r["team_name"]
        entry = by_team.setdefault(team, {
            "team_name": team,
            "league": r["league"],
            "relevance_tier": r["relevance_tier"],
            "wins": 0, "losses": 0, "ties": 0,
            "games": [],
            "ids": [],
        })
        won = r["team_score"] > r["opponent_score"]
        tied = r["team_score"] == r["opponent_score"]
        if tied:
            entry["ties"] += 1
        elif won:
            entry["wins"] += 1
        else:
            entry["losses"] += 1
        entry["games"].append({
            "opponent": r["opponent_name"],
            "home_away": r["home_away"],
            "team_score": r["team_score"],
            "opponent_score": r["opponent_score"],
            "date": r["game_date"],
            "result": "W" if won else ("T" if tied else "L"),
        })
        entry["ids"].append(r["id"])

    # primary-lag först, samma sorteringsordning som /sports-tabellen
    return sorted(by_team.values(), key=lambda t: (t["relevance_tier"] != "primary", t["team_name"]))


def content_hash(team_stats: list[dict]) -> str:
    """Hash av VILKA matchrader (id:n) som ingår -- ändras när något läggs
    till/tas bort, samma mönster som weekly.py/home_sales_digest.py."""
    ids = sorted(str(i) for t in team_stats for i in t["ids"])
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


# ---------------------------------------------------------------------------
# 3. BUILD GROUNDING TEXT -- de enda "fakta" modellen får återge
# ---------------------------------------------------------------------------

def build_grounding_text(team_stats: list[dict], label: str) -> str:
    parts = [f"WEEK: {label}"]
    for t in team_stats:
        record = f"{t['wins']}-{t['losses']}" + (f"-{t['ties']}" if t["ties"] else "")
        parts.append(f"\n{t['team_name']} ({t['league'].upper()}): {record} this week")
        for g in t["games"]:
            vs = "vs" if g["home_away"] == "home" else "at"
            when = g["date"].isoformat() if hasattr(g["date"], "isoformat") else g["date"]
            parts.append(f"- {g['result']} {vs} {g['opponent']} {g['team_score']}-{g['opponent_score']} ({when})")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 4. GENERATE + PUBLISH
# ---------------------------------------------------------------------------

def build_prompt(cfg: dict, label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- THE WEEKLY SPORTS DIGEST:
You are now writing a short weekly sports recap for the week of {label}: ONE
short piece (2-3 short paragraphs) covering the results below for the teams
we track. This replaces the "keep it short (2-5 sentences)" instruction above
with a slightly longer, but still compact, format.

STRUCTURE:
- Lead with whichever result is most notable (a win streak, a close game, a
  shutout, a team that went winless) -- not necessarily the first team listed.
- Cover every team in the source data, but don't give them all equal weight;
  a team with no notable result can get a single sentence.
- Report results only. Do not speculate about standings, playoff chances, or
  what a result means for the rest of the season -- that information is not
  in the source data.

Return ONLY the article text. No preamble, no title."""


def template_fallback(team_stats: list[dict], label: str) -> str:
    """Ren, korrekt sammanfattning när AI-vägen inte håller. Torr men sann."""
    if not team_stats:
        return f"No completed games for the teams we track for the week of {label}."
    parts = [f"Results for the week of {label}:"]
    for t in team_stats:
        record = f"{t['wins']}-{t['losses']}" + (f"-{t['ties']}" if t["ties"] else "")
        lines = [f"{g['result']} {'vs' if g['home_away'] == 'home' else 'at'} "
                 f"{g['opponent']} {g['team_score']}-{g['opponent_score']}" for g in t["games"]]
        parts.append(f"\n{t['team_name']} ({record}): " + "; ".join(lines) + ".")
    return "\n".join(parts)


def generate(team_stats: list[dict], label: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified)."""
    src = build_grounding_text(team_stats, label)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(team_stats, label), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(team_stats, label), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, label)

    def call(extra: str = "") -> str:
        msg = safe_create(
            client,
            model=model, max_tokens=800, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    # GenerationUnavailable (API-fel) -> mall-fallback, samma som ett
    # guardrail-avslag. Se GenerationUnavailable-docstringen i format_prompt.py
    # för incidenten (2026-08-09) det här skyddar mot.
    try:
        text = call()
        result = guardrails.validate(text, src, cfg)

        if not result.passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or speculated beyond the results given. Rewrite using "
                        "ONLY facts explicitly present in the SOURCE DATA, and report only.")
            result = guardrails.validate(text, src, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(team_stats, label), "template_fallback", True

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not result.passed:
        for v in result.violations[:5]:
            print(f"    - {v}")
    return template_fallback(team_stats, label), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true",
                    help="generera om även när underlaget är oförändrat")
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till stories "
                         "(gör ett riktigt AI-anrop -- kostar samma som en publicering)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    start, end, slug, label = previous_week_bounds()
    print(f"Vecka {label}  ({slug})")

    with psycopg.connect(database_url) as conn:
        team_stats = gather_team_week_stats(conn, town_id, start, end)
        total_games = sum(len(t["games"]) for t in team_stats)
        print(f"  underlag: {len(team_stats)} lag, {total_games} avslutade matcher")

        if not team_stats:
            print("  inga avslutade matcher den här veckan -- ingen story skapas")
            return 0

        new_hash = content_hash(team_stats)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                (town_id, slug))
            row = cur.fetchone()

        if row and row[0] == new_hash and not args.force and not args.dry_run:
            print("  underlaget oförändrat -- hoppar över (inget AI-anrop)")
            return 0

        text, generated_by, verified = generate(team_stats, label, cfg)
        title = f"{cfg['display_name']} sports: week of {label}"

        if args.dry_run:
            print("\n" + "=" * 70)
            print(f"TITEL: {title}")
            print(f"GENERATED_BY: {generated_by}  |  VERIFIED: {verified}  |  "
                  f"{len(text.split())} ord")
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
