"""Veckovis "vad händer på State"-sammanfattning -- Brookings-specifik.

Till skillnad från sports_weekly_digest.py (som sammanfattar REDAN SPELADE
matcher, en vecka bakåt) är det här FRAMÅTBLICKANDE, samma vecka-räkning som
ai_pipeline/weekly.py -- veckan som precis börjat (måndag -> söndag), inte
veckan som precis tog slut. Rimligt eftersom sdsu_events är schemalagda
kommande evenemang (matcher, konserter, föreställningar), inte resultat att
recensera i efterhand.

Läser sdsu_events (se scrapers/parsers/sdsu_events_v1.py) inom veckofönstret,
väver ihop till EN kort text i stället för att bara upprepa /university.astro:s
tabell. Delar bas-röst och hårda regler med format_prompt.build_system_prompt.

IDEMPOTENS OCH KOSTNAD: sluggen är deterministisk per vecka
("university-digest-2026-w34"), och underlaget hashas på VILKA event-id:n
som ingår -- samma mönster som weekly.py/sports_weekly_digest.py. En vecka
utan förändrat underlag sedan förra körningen kostar inget nytt AI-anrop.

Körning:
    python -m ai_pipeline.sdsu_weekly_digest --config configs/brookings_sd.json
    python -m ai_pipeline.sdsu_weekly_digest --config configs/brookings_sd.json --force
    python -m ai_pipeline.sdsu_weekly_digest --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from ai_pipeline.publish import prefix_town_name
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "university_digest"

# under så här många ord är resultatet inte en riktig sammanfattning
MIN_WORDS = 60


def _day(dt) -> str:
    return str(dt.day)


def week_bounds(tz: ZoneInfo) -> tuple[datetime, datetime, str, str]:
    """Måndag 00:00 till nästa måndag 00:00 i ortens tidszon -- samma
    vecka-räkning som ai_pipeline/weekly.py (INNEVARANDE vecka, inte
    föregående -- se moduldocstring för varför)."""
    now = datetime.now(tz)
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = monday + timedelta(days=7)
    iso_year, iso_week, _ = monday.isocalendar()
    slug = f"university-digest-{iso_year}-w{iso_week:02d}"
    last = end - timedelta(days=1)
    if monday.month == last.month:
        label = f"{monday.strftime('%B')} {_day(monday)}–{_day(last)}"
    else:
        label = f"{monday.strftime('%B')} {_day(monday)}–{last.strftime('%B')} {_day(last)}"
    return monday, end, slug, label


def gather_events(conn, town_id: str, start: datetime, end: datetime) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, title, teaser, location, starts_at, primary_category, event_url
              FROM sdsu_events
             WHERE town_id = %s AND starts_at >= %s AND starts_at < %s
               AND NOT is_filtered
             ORDER BY starts_at
            """,
            (town_id, start, end),
        )
        return _dedupe_exact_repeats([dict(r) for r in cur.fetchall()])


def _dedupe_exact_repeats(events: list[dict]) -> list[dict]:
    """SDSU's calendar occasionally lists the exact same real-world event
    twice under two different landing pages (confirmed live: "Playfair -
    The Ultimate Icebreaker" appeared as both /events/.../playfair-ultimate-
    icebreaker and /events/.../yellow-blue-you, same title, same starts_at,
    same location -- sdsu_events_v1.py's dedup key is the URL+time, which
    can't catch this). Dropped here on (title, starts_at), keeping the
    first occurrence -- a real coincidence (two different events sharing a
    title and hour) is vanishingly unlikely for a single campus's calendar."""
    seen: set[tuple] = set()
    out = []
    for e in events:
        key = (e["title"], e["starts_at"])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def gather_academic_dates(conn, town_id: str, start: datetime, end: datetime) -> list[dict]:
    """Academic-calendar dates (term start, breaks, finals, commencement --
    see data/academic_calendar/<town_id>.json) falling in this digest's
    week. Cross-referenced into the grounding text so the model can lead
    with "first week of the semester" context it would otherwise have no
    way to know -- sdsu_events and academic_calendar_dates were previously
    never joined anywhere, which is why a routine campus event could
    outrank convocation/classes-begin in the old digest (see
    NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild", A.2)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT label, category, starts_on, ends_on
              FROM academic_calendar_dates
             WHERE town_id = %s AND starts_on >= %s AND starts_on < %s
             ORDER BY starts_on
            """,
            (town_id, start.date(), end.date()),
        )
        return [dict(r) for r in cur.fetchall()]


def content_hash(events: list[dict], academic_dates: list[dict]) -> str:
    ids = sorted(str(e["id"]) for e in events)
    labels = sorted(f"{d['label']}:{d['starts_on']}" for d in academic_dates)
    return hashlib.sha256("|".join(ids + labels).encode()).hexdigest()


def _fmt(dt, tz: ZoneInfo) -> str:
    """dt kommer tillbaka från Postgres som en UTC-medveten datetime (TIMESTAMPTZ)
    -- MÅSTE konverteras till ortens egen tidszon innan veckodag/klockslag
    läses ut, annars visas t.ex. en 19:00 CDT-match som "Friday 12:00 AM"
    (UTC-midnatt) i stället för korrekt "Thursday 7:00 PM". Upptäckt vid
    liveverifiering 2026-08-10 -- samma klass av bugg som Caltrans-
    tidsstämplarna i traffic_v1.py, fast här är felet att INTE konvertera
    alls (där var felet fel KÄLL-tidszon)."""
    if dt is None:
        return "time TBD"
    local = dt.astimezone(tz)
    hour12 = local.hour % 12 or 12
    return f"{local.strftime('%A')} {_day(local)} at {hour12}:{local.strftime('%M %p')}"


# A cluster of this many-or-more events sharing the exact same start time
# gets collapsed into one grounding-text line instead of listed individually
# -- see NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild", A.2: real data
# had eight separate "College of X Welcome Event" rows all at Sunday 3pm,
# and feeding all eight to the model produced eight near-identical sentences
# instead of one. This is deterministic preprocessing, not a prompt
# instruction -- more reliable than trusting the model to notice and
# collapse the pattern itself.
SIMULTANEOUS_CLUSTER_THRESHOLD = 3


def _collapse_simultaneous(events: list[dict]) -> list[dict | list[dict]]:
    """Groups consecutive (already starts_at-sorted) events sharing the same
    starts_at; a group >= SIMULTANEOUS_CLUSTER_THRESHOLD becomes a single
    list entry (caller renders it as one collapsed line), smaller groups are
    returned as individual dicts unchanged."""
    out: list[dict | list[dict]] = []
    i = 0
    while i < len(events):
        j = i + 1
        while j < len(events) and events[j]["starts_at"] == events[i]["starts_at"]:
            j += 1
        group = events[i:j]
        out.extend(group) if len(group) < SIMULTANEOUS_CLUSTER_THRESHOLD else out.append(group)
        i = j
    return out


def build_grounding_text(events: list[dict], label: str, tz: ZoneInfo,
                          academic_dates: list[dict] | None = None) -> str:
    parts = [f"WEEK: {label}"]

    if academic_dates:
        parts.append("\nSIGNIFICANT ACADEMIC DATES THIS WEEK (lead with these ahead of "
                      "routine campus events -- these affect the whole university):")
        for d in academic_dates:
            span = f" through {d['ends_on']}" if d.get("ends_on") else ""
            parts.append(f"- {d['label']} ({d['category']}): {d['starts_on']}{span}")

    if not events:
        parts.append("\nNo tracked SDSU events (athletics, music, theatre/dance, "
                      "special events, camps/conferences) this week.")
        return "\n".join(parts)

    parts.append("\nSDSU EVENTS THIS WEEK:")
    for item in _collapse_simultaneous(events):
        if isinstance(item, list):
            when = _fmt(item[0].get("starts_at"), tz)
            names = ", ".join(e["title"] for e in item[:3])
            more = f" and {len(item) - 3} more" if len(item) > 3 else ""
            parts.append(f"- {len(item)} events at the same time ({when}): {names}{more} "
                         "-- describe this as one collapsed item (e.g. \"N campus groups/colleges "
                         "held events at the same time\"), not N separate sentences.")
            continue
        e = item
        where = f" at {e['location']}" if e.get("location") else ""
        cat = f" ({e['primary_category']})" if e.get("primary_category") else ""
        parts.append(f"- {e['title']}{cat}: {_fmt(e.get('starts_at'), tz)}{where}")
        if e.get("teaser"):
            parts.append(f"  {e['teaser']}")
    return "\n".join(parts)


def build_prompt(cfg: dict, label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- THE WEEKLY UNIVERSITY DIGEST:
You are now writing a short "what's on at SDSU" preview for the week of
{label}: ONE short piece (2-3 short paragraphs) previewing the events below.
This replaces the "keep it short (2-5 sentences)" instruction above with a
slightly longer, but still compact, format.

STRUCTURE:
- If a SIGNIFICANT ACADEMIC DATE is listed (term start, finals, commencement,
  a major break), lead with it -- it affects the whole university, ahead of
  any single campus event, even a marquee one.
- Otherwise, lead with whichever event is the biggest draw (a marquee
  athletics game, a notable concert or show) -- not necessarily the first
  one chronologically.
- Group similar events together (athletics together, arts/music together)
  so it reads as a preview, not a list. Where the source data already
  collapsed several simultaneous events into one item, describe them as a
  group (e.g. "several colleges held welcome events"), never enumerate them
  individually.
- This is a PREVIEW of what's scheduled, not a recap -- do not describe
  outcomes, scores, or how anything went, since these events haven't
  happened yet.

Return ONLY the article text. No preamble, no title."""


def template_fallback(events: list[dict], label: str, tz: ZoneInfo,
                       academic_dates: list[dict] | None = None) -> str:
    """Ren, korrekt lista när AI-vägen inte håller. Torr men sann."""
    lines = [f"SDSU events for the week of {label}:"]
    for d in (academic_dates or []):
        lines.append(f"- {d['label']}: {d['starts_on']}")
    if not events:
        if not academic_dates:
            return f"No tracked SDSU events for the week of {label}."
        return "\n".join(lines)
    for item in _collapse_simultaneous(events):
        if isinstance(item, list):
            lines.append(f"- {len(item)} events at {_fmt(item[0].get('starts_at'), tz)}")
            continue
        where = f", {item['location']}" if item.get("location") else ""
        lines.append(f"- {item['title']}: {_fmt(item.get('starts_at'), tz)}{where}")
    return "\n".join(lines)


def generate(events: list[dict], label: str, cfg: dict, tz: ZoneInfo, client=None,
             academic_dates: list[dict] | None = None) -> tuple[str, str, bool]:
    """Returnerar (text, generated_by, verified)."""
    src = build_grounding_text(events, label, tz, academic_dates)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(events, label, tz, academic_dates), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(events, label, tz, academic_dates), "template_fallback", True
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
    # guardrail-avslag. Se GenerationUnavailable-docstringen i format_prompt.py.
    try:
        text = call()
        result = guardrails.validate(text, src, cfg)

        if not result.passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or described events as if they'd already happened. "
                        "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
            result = guardrails.validate(text, src, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(events, label, tz, academic_dates), "template_fallback", True

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not result.passed:
        for v in result.violations[:5]:
            print(f"    - {v}")
    return template_fallback(events, label, tz, academic_dates), "template_fallback", True


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
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    start, end, slug, label = week_bounds(tz)
    print(f"Vecka {label}  ({slug})")

    with psycopg.connect(database_url) as conn:
        events = gather_events(conn, town_id, start, end)
        academic_dates = gather_academic_dates(conn, town_id, start, end)
        print(f"  underlag: {len(events)} events, {len(academic_dates)} academic dates")

        if not events and not academic_dates:
            print("  inga SDSU-events eller akademiska datum den här veckan -- ingen story skapas")
            return 0

        new_hash = content_hash(events, academic_dates)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                (town_id, slug))
            row = cur.fetchone()

        if row and row[0] == new_hash and not args.force and not args.dry_run:
            print("  underlaget oförändrat -- hoppar över (inget AI-anrop)")
            return 0

        text, generated_by, verified = generate(events, label, cfg, tz, academic_dates=academic_dates)
        title = prefix_town_name(f"What's on at SDSU: week of {label}", cfg["display_name"])

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
                (town_id, title, slug, text, SOURCE_TYPE, start,
                 generated_by, verified, new_hash))
        conn.commit()

        action = "uppdaterad" if row else "skapad"
        print(f"  {action}: {len(text.split())} ord, {generated_by}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
