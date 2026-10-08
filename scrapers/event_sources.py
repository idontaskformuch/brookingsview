"""Event source registry -- Recurring-traffic layer handoff, Phase 3 part 1.

Before this: scrapers/parsers/events.py dispatched on each sub-source's
`kind` field via a hardcoded if/elif chain inside fetch()/parse(). Adding a
new kind (e.g. Broomfield's planned WebTrac HTML-scrape fallback) meant
editing that control flow directly. This module is the uniform, extensible
replacement: a `kind` string maps to a registered fetch/parse pair, and
EventsParser (unchanged in every other respect) looks sources up here
instead of branching on kind itself.

Per-town specifics (source name, URL, enabled/kind) still live entirely in
configs/<town_id>.json's events.sources[] -- this module only maps
kind -> HOW to fetch and parse that kind of source, never town-specific
data. Config-driven, not town-hardcoded, same as every other registry in
this codebase (see scrapers/runner.py's own REGISTRY for the parser-type
equivalent this deliberately mirrors the shape of).

Every function here is extracted VERBATIM from the pre-refactor
scrapers/parsers/events.py (same regex, same encoding fallback order, same
text-sanity checks) -- a behavior-preserving move, not a rewrite. See
tests/test_event_sources.py, which asserts on real quirks already
documented and fixed once (the P15M REFRESH-INTERVAL bug, the
utf-8/cp1252/replace decode fallback order) so a future edit here can't
silently reintroduce either.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

import requests

from db.db import content_hash
from scrapers.text_sanity import is_suspicious

# Events correctness Phase 1 (2026-10-08): confirmed live -- a Brookings
# chamber ICS LOCATION once came through as the bare two-letter string "SD"
# (the organizer's own calendar platform apparently truncated "Brookings,
# SD" down to just the state code in its export; the live feed no longer
# even has a LOCATION for this entry, so the exact upstream cause can't be
# re-diagnosed, but the symptom -- a bare state code stored as if it were a
# venue name -- is cheap to catch generically). No real venue name is ever
# exactly a US state/territory abbreviation, so this is a safe, narrow
# check: it never flags a legitimate short venue ("Zoom", "The Pub"),
# only an exact 2-letter match. is_suspicious() (text_sanity.py) is
# deliberately scoped to character-level corruption (mojibake, replacement
# chars) -- this is a different, semantic check, so it stays separate
# rather than being folded into that function.
_US_STATE_CODES = frozenset("""
    AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS
    MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV
    WI WY DC AS GU MP PR VI
""".split())


def _is_bare_state_code(text: str) -> bool:
    return text.strip().upper() in _US_STATE_CODES

# See module docstring -- Tockify-exported ICS feeds' X-PUBLISHED-TTL/
# REFRESH-INTERVAL:P15M is malformed RFC 5545 (missing the "T" duration
# designator; "P15M" parses as 15 MONTHS, which the icalendar package
# rejects outright, throwing for the WHOLE document). We never read these
# fields anyway (refresh_minutes governs fetch cadence on our side), so
# they're stripped before parsing with no information loss.
_BAD_REFRESH_PROPS = re.compile(rb"^(X-PUBLISHED-TTL|REFRESH-INTERVAL):.*\r?\n", re.MULTILINE)


def _decode_ics(source_name: str, ics_bytes: bytes) -> str:
    """Decode ICS bytes ourselves, explicitly, instead of handing raw bytes
    to icalendar.Calendar.from_ical() and letting its internal to_unicode()
    decide -- that helper assumes utf-8-sig and, on a UnicodeDecodeError,
    silently retries with errors="replace", swallowing a bad charset into
    replacement characters with no warning surfaced anywhere. Try utf-8
    strict first (correct for every confirmed source so far), then cp1252
    (a library staffer pasting Windows-authored smart quotes/en-dashes into
    a calendar tool that doesn't re-encode). Only fall back to lossy
    replacement, loudly logged, if neither succeeds."""
    for encoding in ("utf-8", "cp1252"):
        try:
            return ics_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    print(f"    [events:{source_name}] kunde inte avkoda som utf-8 eller cp1252 -- "
          "faller tillbaka på utf-8 med ersättningstecken (kontrollera källans charset)")
    return ics_bytes.decode("utf-8", errors="replace")


def _to_iso(dt, tzname: str) -> str | None:
    """icalendar ger antingen date eller datetime; normalisera till ISO-sträng.

    En DTSTART/DTEND utan explicit UTC-offset eller TZID ("floating time"
    enligt RFC 5545) representerar väggklockan PÅ ORTEN -- aldrig UTC. En
    källa som publicerar "19:00" menar 19:00 lokal tid, inte 19:00 UTC (vilket
    för en västkusttid är runt middag lokalt -- fel klockslag, och för sena
    kvällsevent kan det även hamna på fel kalenderdag lokalt). tzname är
    alltid KÄLLANS egen ort (configs/<town_id>.json:s "timezone"), aldrig
    UTC eller körmaskinens egen tid -- se ai_pipeline/time.ts-motsvarigheten
    på sajtsidan för samma disciplin.
    """
    if dt is None:
        return None
    tz = ZoneInfo(tzname)
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tz)
        return dt.isoformat()
    # rent datum (heldagsevent) -> lokal midnatt, inte UTC-midnatt (som kan
    # falla på fel kalenderdag i lokal tid)
    return datetime(dt.year, dt.month, dt.day, tzinfo=tz).isoformat()


def _fetch_ical(source_cfg: dict, headers: dict) -> bytes | None:
    url = source_cfg.get("url")
    if not url:
        return None
    r = requests.get(url, headers=headers, timeout=20)
    r.raise_for_status()
    return r.content


def _parse_ical(source_name: str, ics_bytes: bytes, tzname: str) -> list[dict]:
    try:
        from icalendar import Calendar
    except ImportError:
        print("    [events] paketet 'icalendar' saknas -- lägg till i requirements.txt")
        return []

    ics_text = _decode_ics(source_name, _BAD_REFRESH_PROPS.sub(b"", ics_bytes))

    try:
        cal = Calendar.from_ical(ics_text)
    except Exception as exc:  # noqa: BLE001 — trasig ICS ska inte krascha hela körningen
        print(f"    [events:{source_name}] kunde inte tolka ICS: {exc}")
        return []

    records = []
    for component in cal.walk("VEVENT"):
        uid = str(component.get("UID", ""))
        title = str(component.get("SUMMARY", "")).strip()
        if not title:
            continue

        # Text-sanity-koll (se scrapers/text_sanity.py) -- fångar en
        # felaktigt avkodad post INNAN den når databasen/AI-pipelinen, inte
        # efteråt. En trasig TITEL gör hela posten oanvändbar (rubriken är
        # det enda garanterat synliga fältet) så den posten hoppas över
        # helt; en trasig plats/beskrivning nollas bara ut -- resten av
        # posten är fortfarande användbar.
        if is_suspicious(title):
            print(f"    [events:{source_name}] misstänkt text i titel, hoppar över post "
                  f"(uid={uid}): {title[:80]!r}")
            continue

        dtstart = component.get("DTSTART")
        dtend = component.get("DTEND")
        starts_at = _to_iso(dtstart.dt, tzname) if dtstart else None
        ends_at = _to_iso(dtend.dt, tzname) if dtend else None

        location = str(component.get("LOCATION", "")).strip() or None
        description = str(component.get("DESCRIPTION", "")).strip() or None
        url = str(component.get("URL", "")).strip() or None

        if is_suspicious(location):
            print(f"    [events:{source_name}] misstänkt text i plats (uid={uid}), nollar fältet")
            location = None
        elif location and _is_bare_state_code(location):
            print(f"    [events:{source_name}] plats är bara en delstatskod (uid={uid}): {location!r}, nollar fältet")
            location = None
        if is_suspicious(description):
            print(f"    [events:{source_name}] misstänkt text i beskrivning (uid={uid}), nollar fältet")
            description = None

        records.append({
            "title": title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "venue": location,
            "source": source_name,
            "url": url,
            "raw_data": {"uid": uid, "description": description},
            # 2026-10-02, item D3: content_hash used to include starts_at and
            # title -- found live (a real, user-reported duplicate):
            # "BPN October Meetup - Fly Boy Donuts" (Brookings chamber_business)
            # has the SAME source uid but was scraped at two different
            # starts_at values (Oct 6 and Oct 8) after the organizer corrected
            # the date on GrowthZone's own site between two scrape runs.
            # Hashing starts_at in meant the corrected row looked like a
            # brand-new event (DIFFERENT hash) rather than an update to the
            # same one, so ON CONFLICT DO NOTHING left the old, now-wrong row
            # sitting alongside the new one forever. (source_name, uid) alone
            # is the real, stable identity here -- confirmed safe for
            # recurring series too: a live check of "Free Food Giveaway
            # (Every Sunday)" showed every occurrence already carries its own
            # distinct per-occurrence uid (Tockify's own numbering), not one
            # shared uid relying on starts_at to tell occurrences apart.
            # EventsParser.update_columns (see scrapers/parsers/events.py)
            # makes a hash match actually overwrite the stale fields instead
            # of silently doing nothing.
            "content_hash": content_hash("events", source_name, uid),
        })
    return records


# ChamberMaster/GrowthZone (Brookings Area Chamber of Commerce, verified live
# 2026-09-05) publishes no bulk feed -- only a paginated HTML calendar-grid
# listing (source_cfg["listing_url"], e.g. .../events/Search) and a real
# per-event ICS export (source_cfg["ical_base_url"] + slug + ".ics"). This
# kind crawls the listing once to discover event slugs, then fetches each
# slug's own well-formed ICS individually and parses it with the same
# _parse_ical() used by the "ical" kind above -- no separate HTML-scraping
# code for the actual event data itself, only for slug discovery.
#
# Window/cap chosen from a real live measurement (2026-09-05): a 120-day
# forward window returned 35 unique events (a full calendar year returned
# 227) -- comfortably under MAX_DETAIL_FETCHES, so a normal run fetches
# everything in range rather than silently truncating. Mirrors
# legistar_v1.py's own listing-then-per-item-fetch pattern (MAX_AGENDA_FETCHES
# / FETCH_DELAY_SECONDS) rather than inventing a new politeness convention.
LOOKAHEAD_DAYS = 120
MAX_DETAIL_FETCHES = 60
FETCH_DELAY_SECONDS = 0.25

# Matches both https://.../events/Details/<slug>?... and the
# /bpnevents/Details/<slug> variant (a distinct "module" on the same
# GrowthZone tenant, e.g. their Professional Network sub-brand) -- both
# resolve through the SAME /events/ICal/<slug>.ics endpoint, confirmed live.
_DETAILS_SLUG_RE = re.compile(r'/(?:events|bpnevents)/Details/([^"\'?]+)')

# Deliberately NOT events.py's own b"\n--EVENTSOURCE--\n" separator: that one
# already wraps this kind's entire combined blob as a single value in ITS
# outer join (see events.py fetch()/parse()). Reusing the same literal here
# would make a plain bytes.split() -- used by parse()'s reconstruction-from-
# snapshot fallback when self._blobs isn't cached -- shred this blob's own
# inner per-event boundaries too, since split() doesn't know about nesting.
_BLOB_SEPARATOR = b"\n--CHAMBEREVENTITEM--\n"


def _extract_event_slugs(html: str) -> list[str]:
    seen: dict[str, None] = {}
    for slug in _DETAILS_SLUG_RE.findall(html):
        seen.setdefault(slug, None)
    return list(seen)


def _fetch_html_listing_ical(source_cfg: dict, headers: dict) -> bytes | None:
    listing_url = source_cfg.get("listing_url")
    ical_base_url = source_cfg.get("ical_base_url")
    if not listing_url or not ical_base_url:
        return None

    today = datetime.now(timezone.utc).date()
    until = today + timedelta(days=LOOKAHEAD_DAYS)
    params = {
        "from": today.strftime("%m/%d/%Y"),
        "to": until.strftime("%m/%d/%Y"),
        "mode": "0",
    }
    r = requests.get(listing_url, params=params, headers=headers, timeout=20)
    r.raise_for_status()
    slugs = _extract_event_slugs(r.text)[:MAX_DETAIL_FETCHES]

    blobs: dict[str, bytes] = {}
    for slug in slugs:
        try:
            ir = requests.get(f"{ical_base_url}{slug}.ics", headers=headers, timeout=20)
            ir.raise_for_status()
            blobs[slug] = ir.content
        except Exception as exc:  # noqa: BLE001 -- ett trasigt event ska inte fälla de andra
            print(f"    [events:chamber_business] fel vid hämtning av {slug}: {exc}")
        time.sleep(FETCH_DELAY_SECONDS)

    return _BLOB_SEPARATOR.join(slug.encode() + b"\n" + blob for slug, blob in blobs.items())


def _parse_html_listing_ical(source_name: str, combined: bytes, tzname: str) -> list[dict]:
    records: list[dict] = []
    for chunk in combined.split(_BLOB_SEPARATOR):
        if not chunk.strip():
            continue
        _slug, _, ics_bytes = chunk.partition(b"\n")
        records.extend(_parse_ical(source_name, ics_bytes, tzname))
    return records


@dataclass(frozen=True)
class EventSourceKind:
    """One recognized `kind` value for an events.sources[] entry.

    fetch(source_cfg, headers) -> raw bytes, or None to skip (no url set).
    parse(source_name, raw_bytes, tzname) -> normalized records, same shape
    run_source()/db.upsert_records() already expect from every parser.
    tzname is the town's own IANA zone (configs/<town_id>.json's
    "timezone") -- see _to_iso()'s docstring for why floating-time DTSTART
    values must be localized to it, never to UTC.
    """
    fetch: Callable[[dict, dict], bytes | None]
    parse: Callable[[str, bytes, str], list[dict]]


# "blocked" (policy-blocked, e.g. a robots.txt disallow) and "unconfirmed"
# (Stage 0 not yet verified) are deliberately NOT registered here -- they're
# not fetchable kinds at all, they're inert markers EventsParser checks for
# and skips BEFORE ever consulting this registry (see events.py). Only a
# kind with a real, working fetch+parse implementation belongs here.
EVENT_SOURCE_KINDS: dict[str, EventSourceKind] = {
    "ical": EventSourceKind(fetch=_fetch_ical, parse=_parse_ical),
    "html_listing_ics": EventSourceKind(fetch=_fetch_html_listing_ical, parse=_parse_html_listing_ical),
}
