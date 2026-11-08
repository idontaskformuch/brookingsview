"""`internal` provider `visitbrookings`: club teams that Visit Brookings (visitbrookingssd.com) lists in its public events feed.

Feed: https://visitbrookingssd.com/events/?ical=1 (The Events Calendar, iCal). Which events are sport is decided by the feed's own
CATEGORIES -- the event must carry the configured category (default "Sports"), never a guess from the title. The title is used only to say
WHICH configured team plays and who the opponent is ("Jacks Club Hockey vs Augustana"); a Sports event whose title names no configured
team is left alone. That is also the dedup against internal:sdsu: "SDSU Football vs Indiana State" carries the Sports category too, but
no team here is called "SDSU Football", so the varsity schedule from gojacks.com stays the one source for it.

params: provider, url (the feed), program (sport_programs id), level, category (default "Sports"), tz (default America/Chicago),
        teams: [{"name": "Jacks Club Hockey", "sport": "hockey", "gender": null}]

"X vs Y" is a home game for X (Visit Brookings lists what happens in Brookings); "X at Y" / "X @ Y" is away. The feed carries no scores, so a
row stays 'scheduled'; a game that is over without a result shows as "Result pending" / "No result listed" like every other row.
Facts plus a link back: opponent, local date and time, the venue's name (first line of LOCATION) and the event's own page on Visit Brookings.

Robots: through sports.http.PoliteHttp (standard mode: our user-agent group, else `*`). visitbrookingssd.com `*` disallows only
/events/*/page/, /?eventDate= and /?paged=, Crawl-delay 2 (honoured in full); /events/?ical=1 is allowed (checked 2026-11-08, fixtures in
tests/fixtures/robots/visitbrookings.txt). ToS: none published -- only a privacy policy, footer "All Rights Reserved" -- so the same
facts-and-link rule applies as for the other sources; see .claude/state.md (2026-11-08).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sports.models import NormalizedEvent

SOURCE_PREFIX = "visitbrookings"
_UID_ID = re.compile(r"^(\d+)-")


def _categories(component) -> list[str]:
    raw = component.get("CATEGORIES")
    out: list[str] = []
    for prop in (raw if isinstance(raw, list) else [raw]) if raw is not None else []:
        out += [str(c).strip().lower() for c in getattr(prop, "cats", None) or []]
    return out


def _title_matcher(name: str) -> re.Pattern:
    return re.compile(rf"^\s*{re.escape(name)}\s+(vs\.?|at|@)\s+(.+?)\s*$", re.I)


def parse_feed(ics_text: str, params: dict) -> list[NormalizedEvent]:
    from icalendar import Calendar

    tz = params.get("tz", "America/Chicago")
    zone = ZoneInfo(tz)
    category = params.get("category", "Sports").strip().lower()
    teams = [(_title_matcher(t["name"]), t) for t in params["teams"]]
    program = params["program"]
    out: list[NormalizedEvent] = []
    for comp in Calendar.from_ical(ics_text).walk("VEVENT"):
        if category not in _categories(comp):
            continue
        title = str(comp.get("SUMMARY", "")).strip()
        hit = next(((m, t) for rx, t in teams if (m := rx.match(title))), None)
        start = comp.get("DTSTART")
        if hit is None or start is None or isinstance(start.dt, date) and not isinstance(start.dt, datetime):
            continue
        match, team = hit
        when = start.dt.astimezone(zone) if start.dt.tzinfo else start.dt.replace(tzinfo=zone)
        away = match.group(1) in ("at", "@")
        opponent = match.group(2).strip()
        uid = str(comp.get("UID", ""))
        ident = _UID_ID.match(uid)
        if not ident:
            continue
        location = str(comp.get("LOCATION", "")).strip()
        venue = location.split(",")[0].strip() or None if location else None
        us = {"away_program_id": program} if away else {"home_program_id": program}
        them = {"home_name": opponent} if away else {"away_name": opponent}
        out.append(NormalizedEvent(
            source="internal", source_uid=f"{SOURCE_PREFIX}:{ident.group(1)}:{when.date().isoformat()}",
            sport=team["sport"], level=params.get("level", "amateur"), gender=team.get("gender"),
            start_at=when, tz=tz, program_id=program, venue=venue, url=(str(comp.get("URL", "")).strip() or None), **us, **them))
    return out


def fetch(params: dict, http) -> list[NormalizedEvent]:
    return parse_feed(http.get_text(params["url"]), params)
