"""What's On Phase 6b -- Weekly Editorial Intro.

A short (hard-capped, see MAX_CHARS) AI-written intro paragraph shown above
/whats-on's Marquee section, describing the SHAPE of the current ISO week's
Ticketmaster listings (busy vs. quiet, grouped by kind, a multi-date run
flagged as a run, honest about the regional drive) -- never artist/venue
opinion, never invented local context. See the Phase 6b handoff's own
"central constraint" section for exactly what real data this generator has
access to and what it must never claim.

ARCHITECTURE NOTE: every other ai_pipeline module reads its source data from
Postgres, populated by an earlier scrape step. Ticketmaster has no Python or
DB presence at all -- site/src/lib/ticketmaster.ts fetches Discovery API
live, at Astro BUILD time, and nothing persists it. This module is therefore
the first Python-side Ticketmaster client in this codebase: fetch_events()
below is a deliberate, narrow port of ticketmaster.ts's own
fetchTicketmasterEvents()/isSportsEvent()/isNonEventListing() (same
endpoint, same params, same two filters, same "never throws, returns []"
failure discipline) -- see that file's own comments for the real-data
evidence behind each filter. VENUE_TIERS_BY_ID/VENUE_TIERS_BY_NAME below is
the same kind of cross-layer duplication this codebase already accepts
elsewhere (venue_registry.py <-> db.ts, configs/*.json <-> site-config.ts) --
mirrors site/src/lib/venue-tiers.ts's own curated Brookings-area data
exactly; update both together if a venue tier ever changes.

Gated on features.whats_on.enabled AND features.whats_on.ticketmaster.enabled
in configs/<town_id>.json -- the SAME flag pairing site-config.ts's
hasWhatsOn/ticketmaster.enabled already require for the page itself. Both are
false everywhere today (Phase 7 rollout), so this module is a real, callable,
tested no-op in production until then, same convention as every other What's
On phase before it.

Idempotent per (town_id, ISO week): a content_hash over the full set of
underlying Ticketmaster event ids decides whether to (re)generate --
unchanged since the last successful run, or since generation last failed/had
nothing to say, does nothing. A hash CHANGE (new event, a date drops off, the
week rolled over) always clears any existing row for that week first, then
writes a fresh one only if generation succeeds -- so a stale row (describing
events that no longer match reality) never lingers just because the retry
happened to fail. "Nothing this week" and "guardrail rejected it" are
therefore both simply "no row for this week" on the read side, same
convention as closure_watch_prose.

Running:
    python -m ai_pipeline.whats_on_intro --config configs/brookings_sd.json
    python -m ai_pipeline.whats_on_intro --config configs/brookings_sd.json --dry-run
    python -m ai_pipeline.whats_on_intro --config configs/brookings_sd.json --force
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
import requests

from ai_pipeline import guardrails
from validation import pre_publish_check
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "whats_on_intro"

# "Two or three sentences, not paragraphs" (handoff Step 1) -- ~3 sentences
# at a generous ~130 chars each. Enforced in code (_checks_pass below), not
# just asked for in the prompt.
MAX_CHARS = 420

DISCOVERY_API_BASE = "https://app.ticketmaster.com/discovery/v2/events.json"
PAGE_SIZE = 200
MAX_PAGES = 5
PACING_DELAY_S = 0.25  # mirrors ticketmaster.ts's PACING_DELAY_MS


# --- venue tiers (mirrors site/src/lib/venue-tiers.ts's VENUE_TIERS_BY_ID /
# TICKETMASTER_VENUE_TIERS_BY_NAME exactly -- Ticketmaster venues only, the
# SDSU arts_culture venues in that file have no equivalent here since this
# generator only ever sees Ticketmaster data) ---------------------------------
VENUE_TIERS_BY_ID: dict[str, dict[str, str]] = {
    "brookings_sd": {
        "KovZpZAJAl7A": "large",   # Denny Sanford PREMIER Center
        "Z7r9jZaers": "large",     # Denny Sanford PREMIER Center (2nd Discovery API id, same venue)
        "ZFr9jZA7a6": "medium",    # Washington Pavilion of Arts & Science
        "ZFr9jZ11FA": "medium",    # The District
        "ZFr9jZaAkv": "medium",    # Grand Falls Casino Resort
        "rZ7HnEZ178xxA": "medium", # Icon Events & Dada Gastropub
        "ZFr9jZF6eF": "medium",    # Orpheum Theater Sioux Falls
        "rZ7HnEZ178s_A": "small",  # BIGS Sports Bar
    },
}
VENUE_TIERS_BY_NAME: dict[str, dict[str, str]] = {
    "brookings_sd": {
        "denny sanford premier center": "large",
        "washington pavilion of arts & science": "medium",
        "the district": "medium",
        "grand falls casino resort": "medium",
        "icon events & dada gastropub": "medium",
        "orpheum theater sioux falls - sd": "medium",
        "bigs sports bar": "small",
    },
}
DEFAULT_VENUE_TIER = "small"

_TIER_LABEL = {
    "large": "a large-capacity venue",
    "medium": "a mid-size venue",
    "small": "a small venue",
}


def venue_tier_for(town_id: str, venue_name: str | None, venue_id: str | None = None) -> str:
    if venue_id:
        tier = VENUE_TIERS_BY_ID.get(town_id, {}).get(venue_id)
        if tier:
            return tier
    if not venue_name:
        return DEFAULT_VENUE_TIER
    return VENUE_TIERS_BY_NAME.get(town_id, {}).get(venue_name.strip().lower(), DEFAULT_VENUE_TIER)


# --- fetch (port of site/src/lib/ticketmaster.ts) -----------------------------

def is_sports_event(raw: dict) -> bool:
    """Mirrors ticketmaster.ts's isSportsEvent() exactly -- same real-data
    evidence (every Brookings Sports-segment result, confirmed live)."""
    classifications = raw.get("classifications") or []
    primary = next((c for c in classifications if c.get("primary")), None)
    classification = primary or (classifications[0] if classifications else None)
    return bool(classification and (classification.get("segment") or {}).get("name") == "Sports")


def is_non_event_listing(raw: dict) -> bool:
    """Mirrors ticketmaster.ts's isNonEventListing() exactly -- same real
    "Premium Perch Add-On" / classifications[0].type.name == 'Upsell'
    structural signal."""
    classifications = raw.get("classifications") or []
    primary = next((c for c in classifications if c.get("primary")), None)
    classification = primary or (classifications[0] if classifications else None)
    return bool(classification and (classification.get("type") or {}).get("name") == "Upsell")


def _format_price_range(price_ranges: list[dict] | None) -> str | None:
    """Mirrors site/src/lib/ticketmaster.ts's formatPriceRange() exactly --
    same "$min - $max" / single-value / non-USD-prefix shape, same
    min/max-both-required guard (Discovery API sometimes gives a range with
    only one bound set, which isn't a real usable range)."""
    price_range = (price_ranges or [None])[0]
    if not price_range or price_range.get("min") is None or price_range.get("max") is None:
        return None
    currency = price_range.get("currency")
    prefix = "$" if currency == "USD" else f"{currency or ''} "
    lo, hi = price_range["min"], price_range["max"]
    return f"{prefix}{lo}" if lo == hi else f"{prefix}{lo} - {prefix}{hi}"


def _normalize(raw: dict) -> dict:
    """Raw Discovery API event -> the flat shape the rest of this module
    (and build_grounding_text/collapse_runs) works with. Deliberately keeps
    more fields than ticketmaster.ts's own normalizeTicketmasterEvent() --
    genre (confirmed live 2026-09-07: classifications[0].genre.name, e.g.
    "Ice Shows" for Disney On Ice) and localTime aren't used by the page,
    but this generator's prose legitimately draws on them (handoff's own
    "classification segment/genre" and "matinee vs. late show" examples).
    price_range_text/price_min/price_max/price_currency (event_deck_digest
    follow-up): mirrors ticketmaster.ts's own priceRangeText/priceMin/
    priceMax/priceCurrency fields exactly -- purely additive, this module's
    own weekly-intro prose doesn't use them, only event_deck_digest.py
    does."""
    venues = (raw.get("_embedded") or {}).get("venues") or []
    venue = venues[0] if venues else {}
    attractions = (raw.get("_embedded") or {}).get("attractions") or []
    attraction = attractions[0] if attractions else {}
    classifications = raw.get("classifications") or []
    primary = next((c for c in classifications if c.get("primary")), None)
    classification = primary or (classifications[0] if classifications else {})
    dates = (raw.get("dates") or {}).get("start") or {}
    price_range = (raw.get("priceRanges") or [None])[0]

    return {
        "id": raw.get("id"),
        "title": raw.get("name"),
        "attraction_id": attraction.get("id"),
        "venue_name": venue.get("name"),
        "venue_id": venue.get("id"),
        "venue_distance_miles": venue.get("distance"),
        "segment": (classification.get("segment") or {}).get("name"),
        "genre": (classification.get("genre") or {}).get("name"),
        "occurs_at": dates.get("dateTime"),
        "local_date": dates.get("localDate"),
        "local_time": dates.get("localTime"),
        "price_range_text": _format_price_range(raw.get("priceRanges")),
        "price_min": (price_range or {}).get("min"),
        "price_max": (price_range or {}).get("max"),
        "price_currency": (price_range or {}).get("currency"),
    }


def fetch_events(latitude: float, longitude: float, radius_miles: float, api_key: str | None) -> list[dict]:
    """Fetches every non-Sports, real-event listing within `radius_miles` of
    (`latitude`, `longitude`), normalized via _normalize() above -- mirrors
    ticketmaster.ts's fetchTicketmasterEvents() exactly, including its "never
    throws, empty key/failure -> []" discipline, since this runs unattended
    in CI. Not gated on any enabled flag itself -- main() below decides
    whether to call this at all."""
    if not api_key:
        print("  [whats_on_intro] TICKETMASTER_API_KEY not set -- skipping fetch, no events.")
        return []

    results: list[dict] = []
    try:
        for page in range(MAX_PAGES):
            if page > 0:
                time.sleep(PACING_DELAY_S)
            params = {
                "apikey": api_key, "latlong": f"{latitude},{longitude}",
                "radius": str(radius_miles), "unit": "miles",
                "size": str(PAGE_SIZE), "page": str(page),
            }
            resp = requests.get(DISCOVERY_API_BASE, params=params, timeout=20)
            if not resp.ok:
                print(f"  [whats_on_intro] Discovery API HTTP {resp.status_code} -- stopping, using what was fetched.")
                break
            body = resp.json()
            events = (body.get("_embedded") or {}).get("events") or []
            results.extend(events)
            total_pages = (body.get("page") or {}).get("totalPages", 1)
            if page + 1 >= total_pages:
                break
    except requests.RequestException as exc:
        print(f"  [whats_on_intro] fetch failed: {exc} -- returning no events.")
        return []

    kept = [r for r in results if not is_sports_event(r) and not is_non_event_listing(r)]
    return [_normalize(r) for r in kept]


# --- week bounds + filtering + run collapsing ---------------------------------

def week_bounds(tz: ZoneInfo, now: datetime | None = None) -> tuple[datetime, datetime, int, int]:
    """Monday 00:00 (town tz) to next Monday 00:00 -- same Monday-start
    convention as ai_pipeline/weekly.py's week_bounds() and
    site/src/lib/this-week.ts's currentWeekInfo(), so iso_year/iso_week
    stored here compare directly against that file's own fields on the read
    side, no string slug parsing needed on either side."""
    now = (now or datetime.now(tz)).astimezone(tz)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = monday + timedelta(days=7)
    iso_year, iso_week, _ = monday.isocalendar()
    return monday, end, iso_year, iso_week


def filter_to_week(events: list[dict], start: datetime, end: datetime) -> list[dict]:
    kept = []
    for e in events:
        occurs_at = e.get("occurs_at")
        if not occurs_at:
            continue
        dt = datetime.fromisoformat(occurs_at.replace("Z", "+00:00"))
        if start <= dt < end:
            kept.append(e)
    return kept


def collapse_runs(events: list[dict]) -> list[dict]:
    """Groups same-production, same-venue events into one entry with a
    `members` list -- mirrors site/src/lib/whats-on.ts's
    collapseMarqueeRuns() exactly (same attraction_id + venue_id/name key,
    same "never collapse without a real attraction_id" rule), reused rather
    than reinvented per the handoff's own instruction. Events are assumed
    already in a stable order (occurs_at ascending is what main() passes);
    the first member encountered for a key becomes that entry's primary."""
    entries: list[dict] = []
    index_by_key: dict[str, int] = {}
    for e in events:
        key = f"{e['attraction_id']}::{e.get('venue_id') or e.get('venue_name') or ''}" if e.get("attraction_id") else None
        if key and key in index_by_key:
            entries[index_by_key[key]]["members"].append(e)
            continue
        if key:
            index_by_key[key] = len(entries)
        entries.append({**e, "members": [e]})
    return entries


# --- grounding text + prompt ---------------------------------------------------

_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _format_local(local_date: str | None, local_time: str | None, tz: ZoneInfo) -> tuple[str | None, str]:
    """(weekday_name, "Weekday, Month D[, h:mm AM/PM]") from Discovery API's
    own localDate/localTime -- never re-derived from the UTC dateTime (that
    would risk a day-boundary shift; Discovery API already gives the venue's
    own local calendar date directly)."""
    if not local_date:
        return None, "date TBA"
    y, m, d = (int(x) for x in local_date.split("-"))
    dt = datetime(y, m, d)
    weekday = _WEEKDAY_NAMES[dt.weekday()]
    label = f"{weekday}, {dt.strftime('%B')} {d}"
    if local_time:
        h, mnt, _ = (int(x) for x in local_time.split(":"))
        h12 = h % 12 or 12
        period = "AM" if h < 12 else "PM"
        label += f", {h12}:{mnt:02d} {period}"
    return weekday, label


def build_grounding_text(entries: list[dict], town_id: str, tz: ZoneInfo) -> tuple[str, set[str]]:
    """Returns (grounding text, real weekday names present this week) --
    the latter feeds check_weekday_consistency() below."""
    lines = [f"{len(entries)} distinct event(s)/production(s) this week within the search radius."]
    real_weekdays: set[str] = set()

    for entry in entries:
        tier = venue_tier_for(town_id, entry.get("venue_name"), entry.get("venue_id"))
        dist = entry.get("venue_distance_miles")
        dist_text = f"~{round(dist)} miles from town" if dist is not None else "distance unknown"

        member_labels = []
        for m in entry["members"]:
            weekday, label = _format_local(m.get("local_date"), m.get("local_time"), tz)
            if weekday:
                real_weekdays.add(weekday)
            member_labels.append(label)

        lines.append(
            f"- EVENT: {entry['title']}\n"
            f"  Classification: {entry.get('segment') or 'unclassified'}"
            f"{' / ' + entry['genre'] if entry.get('genre') else ''}\n"
            f"  Venue: {entry.get('venue_name') or 'venue TBA'} ({_TIER_LABEL.get(tier, 'venue')}), {dist_text}\n"
            f"  Date(s) this week: {'; '.join(member_labels)}"
            + (f" ({len(member_labels)} performances)" if len(member_labels) > 1 else "")
        )

    return "\n".join(lines), real_weekdays


def build_prompt(cfg: dict) -> str:
    return build_system_prompt(cfg) + """

FORMAT OVERRIDE -- WHAT'S ON WEEKLY INTRO:
You are writing a short intro paragraph for a "What's On" events listing
page, to appear ABOVE the actual event listing (which the reader will see
right after your text).

ABSOLUTE HARD RULES (violating any of these makes the output unusable):
- Use ONLY the event data in SOURCE DATA below. You have titles,
  classifications/genres, venue names, venue capacity ("a large-capacity
  venue" / "a mid-size venue" / "a small venue"), distances, and dates/times.
  You do NOT know whether any act is good, popular, or locally beloved, you
  know NOTHING about any venue beyond its name and capacity, and you know
  NOTHING about local history, scene context, or this town's own
  relationship to any of it. NEVER write anything that implies otherwise --
  no "fan-favorite", no "don't miss", no "beloved venue", no "a great pick
  for families" -- these are all fabrications, not descriptions.
- Some event titles name a real touring performer you may recognize from
  your own training (a comedian, a band, an author). You MUST NOT use that
  outside knowledge to describe, categorize, or genre-label the event --
  use ONLY the Classification given for that event in SOURCE DATA. If a
  Classification reads "Miscellaneous" or is otherwise vague, describe the
  event generically ("a show", "a performance", "an event") rather than
  guessing a more specific category (e.g. "comedy", "a concert") from the
  performer's name alone -- that guess is exactly the kind of invented
  authority this must never produce, even when it happens to be correct.
- No hype. No "you won't want to miss", no exclamation marks, no invented
  enthusiasm. If the week is quiet (few or no notable events), the honest
  sentence is that the week is quiet -- that is a complete, acceptable
  answer, not a failure to write something more exciting.
- You MAY describe the real shape of the week: how many distinct
  events/productions, whether it's a busy or quiet stretch, grouping by
  kind (e.g. "two comedy shows and a country bill"), noting a multi-date
  run as a run (e.g. "several chances to catch it, not just one night"),
  and being plain about distance -- most of this list is a real drive to a
  venue outside town, and saying so plainly (using the real mileage given)
  is more useful than implying otherwise.
- Two to three sentences. This is an intro, not an article -- a long block
  pushes the real listing below the fold, which defeats its purpose.
- Do not repeat every event's full details -- that's what the listing below
  already does. Characterize the week, don't transcribe the data.

Return ONLY the intro paragraph. No title, no preamble, no markdown."""


def content_hash(entries: list[dict]) -> str:
    ids = sorted(m["id"] for entry in entries for m in entry["members"])
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


def check_intro(
    candidate: str, src: str, cfg: dict, real_weekdays: set[str], source_records: list[dict],
) -> tuple[bool, list[str]]:
    """The full validation gate for one candidate intro -- extracted to a
    standalone, network-free function (rather than a closure inside
    generate() below) specifically so it's directly unit-testable with
    synthetic text, the same reason lib/whats-on.ts's collapseMarqueeRuns()
    is exported separately from any I/O. Composes, in order: the character
    ceiling (Step 1's own "hard ceiling in code, not just in the prompt"),
    guardrails.validate() (numbers/proper-nouns must appear in `src`),
    guardrails.check_weekday_consistency() (a weekday name must be one this
    week's real events actually fall on), and -- only once those pass --
    the shared pre_publish_check() gate every generated content type must
    pass, non-negotiable per the handoff's own Step 2."""
    violations: list[str] = []
    if len(candidate) > MAX_CHARS:
        violations.append(f"over length: {len(candidate)} chars > {MAX_CHARS} ceiling")
    violations += guardrails.validate(candidate, src, cfg).violations
    violations += guardrails.check_weekday_consistency(candidate, real_weekdays).violations
    if not violations:
        violations = pre_publish_check(
            candidate, source_records=source_records, cfg=cfg, content_type=SOURCE_TYPE,
        ).violations
    return not violations, violations


def generate(entries: list[dict], cfg: dict, town_id: str, tz: ZoneInfo, client=None) -> tuple[str, str] | None:
    """Returns (text, generated_by) on a check-passing draft, or None if
    nothing should be written (budget cap, no client, API failure, or a
    guardrail/pre_publish_check rejection surviving one retry)."""
    src, real_weekdays = build_grounding_text(entries, town_id, tz)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return None

    if client is None:
        if anthropic is None:
            return None
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg)
    source_records = [m for entry in entries for m in entry["members"]]

    def call(extra: str = "") -> str | None:
        try:
            msg = safe_create(
                client, model=model, max_tokens=300, system=system + extra,
                messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
            )
        except GenerationUnavailable as exc:
            print(f"  [whats_on_intro] AI call failed ({exc}) -- no intro this run", file=sys.stderr)
            return None
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        return check_intro(candidate, src, cfg, real_weekdays, source_records)

    text = call()
    if text is None:
        return None
    text = text.strip()

    passed, violations = _checks_pass(text)
    if not passed:
        text = call(
            "\n\nYour previous attempt either exceeded the length limit, named something "
            "not in the SOURCE DATA, or implied knowledge you don't have (an opinion about "
            "quality/popularity, or local context). Rewrite it: shorter if needed, using "
            "ONLY facts from SOURCE DATA, describing only the shape of the week."
        )
        if text is None:
            return None
        text = text.strip()
        passed, violations = _checks_pass(text)

    if passed:
        return text, f"ai:{model}"

    print("  [whats_on_intro] guardrail rejection survived retry -- writing nothing")
    for v in violations[:5]:
        print(f"    - {v}")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true", help="regenerate even if this week's content hash is unchanged")
    ap.add_argument("--dry-run", action="store_true", help="fetch + generate and print, but write NOTHING to the DB")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    feat = cfg.get("features", {}).get("whats_on", {})
    tm = feat.get("ticketmaster", {})

    if not feat.get("enabled") or not tm.get("enabled"):
        print(f"What's On (or its Ticketmaster source) disabled for {town_id} -- nothing to do")
        return 0

    coords = cfg.get("coordinates", {})
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))
    api_key = os.environ.get("TICKETMASTER_API_KEY")

    monday, end, iso_year, iso_week = week_bounds(tz)
    print(f"Week {iso_year}-W{iso_week:02d} ({monday.date()} - {(end - timedelta(days=1)).date()})")

    raw_events = fetch_events(coords.get("lat"), coords.get("lon"), tm.get("radius_miles", 75), api_key)
    week_events = sorted(filter_to_week(raw_events, monday, end), key=lambda e: e["occurs_at"])
    entries = collapse_runs(week_events)
    print(f"  {len(week_events)} event(s) this week, {len(entries)} distinct after collapsing runs")

    new_hash = content_hash(entries) if entries else None

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM whats_on_intro WHERE town_id=%s AND iso_year=%s AND iso_week=%s",
                (town_id, iso_year, iso_week),
            )
            row = cur.fetchone()
        existing_hash = row[0] if row else None

        if existing_hash == new_hash and not args.force:
            print("  unchanged since last run -- skipping")
            return 0

        if args.dry_run:
            if not entries:
                print("  no events this week -- no block would be written")
                return 0
            result = generate(entries, cfg, town_id, tz)
            if result:
                print("\n" + "=" * 70)
                print(result[0])
                print("=" * 70)
                print(f"({len(result[0])} chars)")
            else:
                print("  no intro generated -- no block would be written")
            return 0

        # Hash changed (or --force): clear any existing row for this week
        # first -- it no longer reflects current data either way, and a
        # failed/rejected regeneration below must not leave it behind.
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM whats_on_intro WHERE town_id=%s AND iso_year=%s AND iso_week=%s",
                (town_id, iso_year, iso_week),
            )
        conn.commit()

        if not entries:
            print("  no events this week -- no block")
            return 0

        result = generate(entries, cfg, town_id, tz)
        if result is None:
            return 0

        text, generated_by = result
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO whats_on_intro (town_id, iso_year, iso_week, body, content_hash, generated_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (town_id, iso_year, iso_week) DO UPDATE SET
                    body = EXCLUDED.body, content_hash = EXCLUDED.content_hash,
                    generated_by = EXCLUDED.generated_by, created_at = now()
                """,
                (town_id, iso_year, iso_week, text, new_hash, generated_by),
            )
        conn.commit()
        print(f"  intro written ({generated_by}, {len(text)} chars)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
