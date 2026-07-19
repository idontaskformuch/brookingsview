"""Veckosammanfattning -- "This week in Brookings".

Väver ihop veckans möten, evenemang och SDSU-matcher till EN sammanhängande
artikel på 400-600 ord, i stället för trettio korta notiser.

VARFÖR: sajten består annars av 2-5 meningar långa blurbar genererade från
offentlig data. Det är precis den profil som fick vertoq.net flaggat för "low
value content" hos AdSense. En veckoartikel som sätter ihop delarna till en
helhet är kvalitativt något annat -- den ger kontext ingen enskild källa har,
och den är det starkaste innehållsargumentet sajten kan visa en granskare.

IDEMPOTENS OCH KOSTNAD: sluggen är deterministisk per ISO-vecka
("weekly-2026-w30"), och underlaget hashas. Ändras inget under veckan görs inget
AI-anrop alls. Läggs ett nytt biblioteksevenemang till på onsdagen genereras
artikeln om -- annars vore den inaktuell resten av veckan. Kostnaden landar på
några ören per omgenerering, spårad i samma budgetliggare som resten av
pipelinen.

Delar redaktionella regler med format_prompt (inga personnamn, inga
karaktäriseringar, bara källfakta) men har en egen, längre promptmall --
formatkraven skiljer sig helt från en kort notis.

Körning:
    python -m ai_pipeline.weekly --config configs/brookings_sd.json
    python -m ai_pipeline.weekly --config configs/brookings_sd.json --force
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
# Samma budgetliggare som format_prompt -- två separata räknare skulle göra
# taket i configen meningslöst.
from ai_pipeline.format_prompt import (
    build_system_prompt, _spent_this_month, _record_spend,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

_USD_PER_INPUT_TOKEN = 3.0 / 1_000_000
_USD_PER_OUTPUT_TOKEN = 15.0 / 1_000_000


# Windows saknar strftime-flaggorna %-d och %-I (samma bugg som redan fixats en
# gång i publish.py). Formateras manuellt i stället för att förlita sig på dem.
def _day(dt) -> str:
    return str(dt.day)


def _clock(dt) -> str:
    hour = dt.hour % 12 or 12
    return f"{hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


# under så här många ord är resultatet inte en sammanfattning -- då är något fel
MIN_WORDS = 180


def week_bounds(tz: ZoneInfo, offset_weeks: int = 0) -> tuple[datetime, datetime, str, str]:
    """Måndag 00:00 till nästa måndag 00:00 i ortens tidszon."""
    now = datetime.now(tz)
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(weeks=offset_weeks)
    end = monday + timedelta(days=7)
    iso_year, iso_week, _ = monday.isocalendar()
    slug = f"weekly-{iso_year}-w{iso_week:02d}"
    last = end - timedelta(days=1)
    if monday.month == last.month:
        label = f"{monday.strftime('%B')} {_day(monday)}–{_day(last)}"
    else:
        label = f"{monday.strftime('%B')} {_day(monday)}–{last.strftime('%B')} {_day(last)}"
    return monday, end, slug, label


def collect(conn, town_id: str, start: datetime, end: datetime) -> dict:
    """Hämta veckans underlag ur källtabellerna.

    OBS tidszon: meeting_date är ett rent KALENDERDATUM lagrat som midnatt UTC
    (Legistar/CivicEngage ger bara ett datum). Jämförs det mot Chicago-baserade
    veckogränser hamnar ett möte den 20 juli på 19 juli kl. 19:00 lokalt, alltså
    i fel vecka. Möten filtreras därför på UTC-datumgränser; events och matcher
    har riktiga tidsstämplar och använder de tidszonsmedvetna gränserna. Samma
    rotorsak som datumbuggen i frontend, se formatCalendarDate i site/src/lib/db.ts.
    """
    utc_start = datetime.combine(start.date(), datetime.min.time(), tzinfo=UTC)
    utc_end = datetime.combine(end.date(), datetime.min.time(), tzinfo=UTC)

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, body, meeting_date, agenda_url, raw_data
              FROM meetings
             WHERE town_id = %s AND meeting_date >= %s AND meeting_date < %s
             ORDER BY meeting_date
            """, (town_id, utc_start, utc_end))
        meetings = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT id, title, starts_at, venue, source, url, raw_data
              FROM events
             WHERE town_id = %s AND starts_at >= %s AND starts_at < %s
               AND source NOT IN ('nws_alert', 'county_alert')
             ORDER BY starts_at
            """, (town_id, start, end))
        events = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT id, sport, opponent, home_away, starts_at, venue, result
              FROM sports_games
             WHERE town_id = %s AND starts_at >= %s AND starts_at < %s
             ORDER BY starts_at
            """, (town_id, start, end))
        games = [dict(r) for r in cur.fetchall()]

    return {"meetings": meetings, "events": events, "games": games}


def content_hash(data: dict) -> str:
    """Hash av VILKA poster som ingår -- ändras när något läggs till/tas bort."""
    ids = sorted(
        f"{kind}:{row['id']}" for kind, rows in data.items() for row in rows
    )
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


def _fmt(dt, with_time: bool = True) -> str:
    if dt is None:
        return ""
    if isinstance(dt, str):
        return dt
    base = f"{dt.strftime('%A %B')} {_day(dt)}"
    return f"{base}, {_clock(dt)}" if with_time else base


def source_text(data: dict, label: str) -> str:
    """Platta ut underlaget till den text AI:n (och guardrails) arbetar mot."""
    parts = [f"WEEK: {label}"]

    if data["meetings"]:
        parts.append("\nPUBLIC MEETINGS THIS WEEK:")
        for m in data["meetings"]:
            raw = m.get("raw_data") or {}
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except ValueError:
                    raw = {}
            agenda = (raw.get("agenda_text") or "").strip()
            parts.append(f"- {m.get('body')} on {_fmt(m.get('meeting_date'), False)}")
            if agenda:
                parts.append(f"  Agenda: {agenda[:2500]}")

    if data["events"]:
        parts.append("\nCOMMUNITY EVENTS THIS WEEK:")
        for e in data["events"]:
            venue = f" at {e['venue']}" if e.get("venue") else ""
            parts.append(f"- {e.get('title')} on {_fmt(e.get('starts_at'))}{venue}")
            raw = e.get("raw_data") or {}
            if isinstance(raw, dict) and raw.get("description"):
                parts.append(f"  {str(raw['description'])[:400]}")

    if data["games"]:
        parts.append("\nSDSU JACKRABBITS THIS WEEK:")
        for g in data["games"]:
            where = "at home" if g.get("home_away") == "home" else "away"
            venue = f" at {g['venue']}" if g.get("venue") else ""
            result = f" Result: {g['result']}." if g.get("result") else ""
            parts.append(
                f"- {g.get('sport')} vs {g.get('opponent')} ({where}) "
                f"on {_fmt(g.get('starts_at'))}{venue}.{result}"
            )

    return "\n".join(parts)


def build_prompt(cfg: dict, label: str) -> str:
    """Basrösten + hårda reglerna ÅTERANVÄNDS från format_prompt.build_system_prompt.

    Duplicerade regler skulle glida isär -- justeras tonen där ska den slå igenom
    här också. Nedan läggs bara det till som är specifikt för formatet: längd,
    struktur och viktning, vilket uttryckligen skriver över basmallens
    "keep it short (2-5 sentences)".
    """
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- THE WEEKLY ROUNDUP:
You are now writing the weekly roundup for the week of {label}: ONE connected
article of 400-600 words. This replaces the "keep it short" instruction above.

STRUCTURE:
- Open with the most consequential thing happening this week for residents.
  Usually that is a decision at a public meeting, not an entertainment listing.
- Group related items so it reads as one article, not a list. Public business
  together, community life together, Jackrabbits together.
- Short paragraphs, connected prose. No bullet points, no markdown headers.
- Close with what residents can attend or take part in.

WEIGHTING: give the most space to decisions about housing, roads, taxes, safety
and access. A permit hearing outranks a craft class. Equal length for every item
is exactly what makes an automated roundup read as automated.

Return ONLY the article text. No preamble, no title."""


def template_fallback(data: dict, label: str, cfg: dict) -> str:
    """Ren, korrekt lista när AI-vägen inte håller. Torr men sann."""
    town = cfg["display_name"]
    lines = [f"Here is what is on the calendar in {town} for the week of {label}."]
    if data["meetings"]:
        lines.append("\nPublic meetings:")
        lines += [f"{m.get('body')} meets {_fmt(m.get('meeting_date'), False)}."
                  for m in data["meetings"]]
    if data["events"]:
        lines.append("\nCommunity events:")
        lines += [f"{e.get('title')}, {_fmt(e.get('starts_at'))}"
                  + (f", {e['venue']}" if e.get("venue") else "") + "."
                  for e in data["events"]]
    if data["games"]:
        lines.append("\nSDSU Jackrabbits:")
        lines += [f"{g.get('sport')} "
                  + ("vs " if g.get("home_away") == "home" else "at ")
                  + f"{g.get('opponent')}, {_fmt(g.get('starts_at'))}."
                  for g in data["games"]]
    lines.append("\nEvery item above comes from a public source. See the section "
                 "pages for full agendas, schedules and registration details.")
    return "\n".join(lines)


def generate(data: dict, label: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified)."""
    src = source_text(data, label)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(data, label, cfg), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(data, label, cfg), "template_fallback", True
        client = anthropic.Anthropic()

    model = ai_cfg.get("model", "claude-sonnet-5")
    system = build_prompt(cfg, label)

    def call(extra: str = "") -> str:
        msg = client.messages.create(
            model=model, max_tokens=1600, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * _USD_PER_INPUT_TOKEN
                      + msg.usage.output_tokens * _USD_PER_OUTPUT_TOKEN)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    text = call()
    result = guardrails.validate(text, src, cfg)

    if not result.passed:
        text = call("\n\nYour previous attempt included details not found in the "
                    "source. Rewrite using ONLY facts explicitly present in the "
                    "SOURCE DATA.")
        result = guardrails.validate(text, src, cfg)

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not result.passed:
        for v in result.violations[:5]:
            print(f"    - {v}")
    return template_fallback(data, label, cfg), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true",
                    help="generera om även när underlaget är oförändrat")
    ap.add_argument("--next-week", action="store_true",
                    help="bygg för nästa vecka i stället för innevarande")
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till stories "
                         "(gör ett riktigt AI-anrop -- kostar samma som en publicering)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))

    start, end, slug, label = week_bounds(tz, 1 if args.next_week else 0)
    print(f"Vecka {label}  ({slug})")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        data = collect(conn, town_id, start, end)
        counts = {k: len(v) for k, v in data.items()}
        print(f"  underlag: {counts}")

        if sum(counts.values()) == 0:
            print("  inget att sammanfatta -- ingen story skapas")
            return 0

        new_hash = content_hash(data)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                (town_id, slug))
            row = cur.fetchone()

        if row and row[0] == new_hash and not args.force and not args.dry_run:
            print("  underlaget oförändrat -- hoppar över (inget AI-anrop)")
            return 0

        text, generated_by, verified = generate(data, label, cfg)
        title = f"This week in {cfg['display_name']}: {label}"

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
                     generated_by, verified, content_hash, published_at)
                VALUES (%s,%s,%s,%s,'weekly',%s,%s,%s,%s,now())
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    generated_by = EXCLUDED.generated_by,
                    verified = EXCLUDED.verified,
                    content_hash = EXCLUDED.content_hash,
                    published_at = now()
                """,
                (town_id, title, slug, text, start, generated_by, verified, new_hash))
        conn.commit()

    words = len(text.split())
    action = "uppdaterad" if row else "skapad"
    print(f"  {action}: {words} ord, {generated_by}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
