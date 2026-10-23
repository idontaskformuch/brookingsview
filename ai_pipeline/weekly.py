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
import re
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
from ai_pipeline import api_usage
from validation import pre_publish_check
# Samma budgetliggare som format_prompt -- två separata räknare skulle göra
# taket i configen meningslöst.
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None


# Windows saknar strftime-flaggorna %-d och %-I (samma bugg som redan fixats en
# gång i publish.py). Formateras manuellt i stället för att förlita sig på dem.
def _day(dt) -> str:
    return str(dt.day)


def _clock(dt, tz: ZoneInfo | None = None) -> str:
    # FAS 2-FIX (augusti 2026): läste tidigare dt.hour/dt.minute rakt av på
    # ett UTC-medvetet datetime-objekt, samma buggklass som redan fixats i
    # publish.py:_fmt_hour_min -- ett kvällsevent som passerar UTC-midnatt
    # skrevs ut med fel klockslag i veckosammanfattningen. Konvertera till
    # ortens tidszon FÖRST, om en angetts (meeting_date skickar aldrig in
    # tz, se _fmt/source_text -- samma "inget tillförlitligt klockslag"-skäl
    # som collect()s docstring redan förklarar för datumdelen).
    if tz is not None:
        dt = dt.astimezone(tz)
    hour = dt.hour % 12 or 12
    return f"{hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


# under så här många ord är resultatet inte en sammanfattning -- då är något fel
MIN_WORDS = 25  # intro paragraph only (3-4 sentences); the lists on the page are built from data, not by the model


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


def _fmt(dt, with_time: bool = True, tz: ZoneInfo | None = None) -> str:
    if dt is None:
        return ""
    if isinstance(dt, str):
        return dt
    base = f"{dt.strftime('%A %B')} {_day(dt)}"
    return f"{base}, {_clock(dt, tz)}" if with_time else base


def source_text(data: dict, label: str, tz: ZoneInfo) -> str:
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
            parts.append(f"- {e.get('title')} on {_fmt(e.get('starts_at'), tz=tz)}{venue}")
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
                f"on {_fmt(g.get('starts_at'), tz=tz)}{venue}.{result}"
            )

    return "\n".join(parts)


_WEEKDAY_RE = re.compile(r"\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)day\b", re.IGNORECASE)
_CLOCK_RE = re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?!\w)|\b\d{1,2}:\d{2}\b|\b(?:noon|midnight)\b", re.IGNORECASE)
_MONTH_DAY_RE = re.compile(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b", re.IGNORECASE)
MAX_INTRO_WORDS = 90


def intro_format_violations(text: str) -> list[str]:
    """The roundup intro must not carry days, clock times, dates or lists: the page's own list has them
    on every line. A deterministic check on top of the prompt, because a model drifts."""
    out: list[str] = []
    if _WEEKDAY_RE.search(text):
        out.append("intro names a day of the week (the list carries days)")
    if _CLOCK_RE.search(text):
        out.append("intro states a clock time (the list carries times)")
    if _MONTH_DAY_RE.search(text):
        out.append("intro states a calendar date (the list carries dates)")
    if len(text.split()) > MAX_INTRO_WORDS:
        out.append(f"intro is longer than {MAX_INTRO_WORDS} words")
    if len([p for p in text.split(chr(10)) if p.strip()]) > 1:
        out.append("intro is more than one paragraph")
    if any(line.lstrip().startswith(("-", "*", "#")) for line in text.split(chr(10))):
        out.append("intro contains a list or header")
    return out



def build_prompt(cfg: dict, label: str) -> str:
    """Basrösten + hårda reglerna ÅTERANVÄNDS från format_prompt.build_system_prompt.

    Duplicerade regler skulle glida isär -- justeras tonen där ska den slå igenom
    här också. Nedan läggs bara det till som är specifikt för formatet: längd,
    struktur och viktning, vilket uttryckligen skriver över basmallens
    "keep it short (2-5 sentences)".
    """
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- THE WEEKLY ROUNDUP INTRO (2026-10-23 restructure):
You are writing ONLY the short introduction to the roundup for the week of {label}:
ONE paragraph of 3 to 4 sentences, at most 80 words. This replaces the "keep it
short (2-5 sentences)" instruction above. The page lists every meeting, event and
game itself, grouped by theme, right below your paragraph, with the day and time
on each line -- so your paragraph must NOT repeat that list.

WHAT TO WRITE:
- Say what marks this week for residents. Lead with the most consequential public
  decision or meeting if there is one; otherwise with the biggest community or
  campus occasion. One or two things, named plainly, then a sentence on the
  general character of the rest of the week (for example "a busy week for
  campus concerts").
- NO days of the week, NO times, NO dates, NO lists, NO bullet points, NO
  headers. Do not write "on Tuesday" or "at 7 p.m."; the list carries those.
- Connected prose in one paragraph. Do not name every event.

WEIGHTING: decisions about housing, roads, taxes, safety and access outrank
entertainment. A permit hearing outranks a craft class.

SYNTHESIS: for the one item you lead with, add a short clause on what it
practically means for residents -- what changes, who it affects -- and keep it
grounded ONLY in what the source data states, never inferred. Never predict an outcome, a vote result, or a timeline beyond what the
source explicitly says. A restated headline is not synthesis.

Return ONLY the paragraph. No preamble, no title."""


def template_fallback(data: dict, label: str, cfg: dict) -> str:
    """Short, true intro when the AI path does not hold: counts only. The page lists the items."""
    town = cfg["display_name"]
    parts = []
    if data["meetings"]:
        parts.append(f"{len(data['meetings'])} public meeting{'s' if len(data['meetings']) != 1 else ''}")
    if data["events"]:
        parts.append(f"{len(data['events'])} community event{'s' if len(data['events']) != 1 else ''}")
    if data["games"]:
        parts.append(f"{len(data['games'])} Jackrabbits game{'s' if len(data['games']) != 1 else ''}")
    what = ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1] if parts else "no scheduled items"
    return (f"The calendar in {town} for the week of {label} has {what}. "
            "Everything below comes from a public source and links to the original, "
            "with the day and time on each line.")


def generate(data: dict, label: str, cfg: dict, client=None, dry_run: bool = False) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified).

    `dry_run`: --dry-run still makes a real AI call (see main()'s own
    comment -- it costs the same as a publish) but never writes to stories,
    so a successful generation's api_usage row is finalized 'dry_run'
    instead of 'published' -- otherwise cost_report.py's waste query, which
    treats anything other than published/dry_run as wasted spend, would be
    unable to tell a real publish apart from a --dry-run test run.
    """
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))
    src = source_text(data, label, tz)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(data, label, cfg), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(data, label, cfg), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model("weekly", cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, label)

    usage_ids: list[int] = []

    def call(extra: str = "") -> str:
        with api_usage.usage_context(generator="weekly", town_id=cfg.get("town_id")):
            msg = safe_create(
                client,
                model=model, max_tokens=400, system=system + extra,
                messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
                attempt=len(usage_ids) + 1,
            )
        usage_id = api_usage.take_last_usage_id()
        if usage_id is not None:
            usage_ids.append(usage_id)
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    # GenerationUnavailable (API-fel) -> mall-fallback, samma som ett
    # guardrail-avslag. Se GenerationUnavailable-docstringen i format_prompt.py
    # för incidenten (2026-08-09) det här skyddar mot.
    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        result = guardrails.validate(candidate, src, cfg)
        violations = list(result.violations) + intro_format_violations(candidate)
        if not violations:
            violations = pre_publish_check(
                candidate, source_records=data, cfg=cfg, content_type="weekly",
            ).violations
        return not violations, violations

    try:
        text = call()
        passed, violations = _checks_pass(text)

        if not passed:
            text = call("\n\nYour previous attempt was rejected: " + "; ".join(violations[:4]) + ". "
                        "Rewrite it as ONE paragraph of 3 to 4 sentences, under 70 words, with NO "
                        "day names, NO clock times and NO dates anywhere (not even 'Tuesday' or "
                        "'this Saturday': say 'this week' or describe the event instead), using "
                        "ONLY facts explicitly present in the SOURCE DATA.")
            passed, violations = _checks_pass(text)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        api_usage.finalize_generation(usage_ids, succeeded=False)
        return template_fallback(data, label, cfg), "template_fallback", True

    if passed and len(text.split()) >= MIN_WORDS:
        api_usage.finalize_generation(usage_ids, succeeded=True,
                                      success_outcome="dry_run" if dry_run else "published")
        return text, f"ai:{model}", True

    reason = "guardrail" if not passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not passed:
        for v in violations[:5]:
            print(f"    - {v}")
    api_usage.finalize_generation(usage_ids, succeeded=False)
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

        text, generated_by, verified = generate(data, label, cfg, dry_run=args.dry_run)
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
