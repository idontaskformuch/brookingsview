"""`sportspress_calendar`: one SportsPress (WordPress plugin) calendar page, "event blocks" layout, read from the server HTML.

First user: Queen's Park (queensparkfc.co.uk/calendar/mens-combined-26-27/ and /womens-combined-26-27/, sports-deep S2, owner 2026-11-15).
The page carries the whole season in one table (table.sp-event-blocks), one tr.sp-row per game:
  time.sp-event-date[content]   ISO start with offset ("2026-11-21T15:00:15+00:00"; the seconds are noise and are dropped)
  .sp-result                    two numbers = the score, in title order (home first); one cell = the kick-off ("3:00 pm") or "TBD"
  .sp-event-league              the competition
  .sp-event-venue               the ground; a second, hidden (display:none) venue block always says "N/A" and is never read
  h4.sp-event-title             "Home v Away"
There is no per-game link and no iCal on the page: the event's `url` is the calendar page itself (the row's source link).

params: url (the calendar page), program (sport_programs id), team (the team's name as the page writes it, e.g. "Queen's Park Women";
        typographic apostrophes are matched as plain ones), sport, level, gender, optional tz (default Europe/London).

A row whose title does not name `team` on one side is left alone. "TBD"/"TBC" in the result cell sets time_tba (start_at is local
midnight; the page's own placeholder clock is not shown). "Postponed"/"Cancelled" in the result cell sets that status. A visible kick-off
that differs from the start's clock wins (it is what the page shows). The ground comes from the page; a game with no visible ground has
venue None and the site falls back to config (sports/venues.py), never a guess here. A page without the calendar table raises: a changed
layout is an error, not an empty season.

Robots: through sports.http.PoliteHttp. queensparkfc.co.uk robots.txt (Yoast) allows everything, no Crawl-delay (read 2026-11-15,
tests/fixtures/robots/queensparkfc.txt). ToS: no terms page found, only policies (notes/sports-deep-phase2-reading-2026-11-15.md); the
facts-and-link rule applies: date, time, teams, ground, competition, score and a link back. No logos.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from sports import adapters
from sports.http import PoliteHttp
from sports.models import NormalizedEvent

NAME = "sportspress_calendar"
_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$", re.I)
_SCORE = re.compile(r"^\d+$")
_TBA = re.compile(r"^(tbd|tbc|tba)$", re.I)


def _plain(text: str) -> str:
    return " ".join(text.replace("’", "'").replace("‘", "'").split())


def _clock(text: str) -> tuple[int, int] | None:
    m = _CLOCK.match(text.strip())
    if not m or not 1 <= int(m.group(1)) <= 12:
        return None
    return int(m.group(1)) % 12 + (12 if m.group(3).lower() == "p" else 0), int(m.group(2))


def _venue(row) -> str | None:
    for block in row.select(".sp-event-venue"):
        if "display:none" in (block.get("style") or "").replace(" ", ""):
            continue
        name = _plain(block.get_text(" ", strip=True))
        if name and name.upper() != "N/A":
            return name
    return None


def parse_calendar(html: str, params: dict) -> list[NormalizedEvent]:
    table = BeautifulSoup(html, "html.parser").select_one("table.sp-event-blocks")
    if table is None:
        raise ValueError("no SportsPress event-blocks table on the page")
    tz = params.get("tz", "Europe/London")
    zone = ZoneInfo(tz)
    team = _plain(params["team"]).lower()
    program = params["program"]
    out: list[NormalizedEvent] = []
    for row in table.select("tr.sp-row"):
        when, title = row.select_one("time.sp-event-date"), row.select_one(".sp-event-title")
        if when is None or title is None or not when.get("content"):
            continue
        sides = [s.strip() for s in _plain(title.get_text(" ", strip=True)).split(" v ")]
        if len(sides) != 2 or team not in (sides[0].lower(), sides[1].lower()):
            continue
        away = sides[1].lower() == team
        opponent = sides[0] if away else sides[1]
        start = datetime.fromisoformat(when["content"]).astimezone(zone).replace(second=0, microsecond=0)
        cells = [_plain(c.get_text(" ", strip=True)) for c in row.select(".sp-result")]
        status, scores, time_tba = "scheduled", {}, False
        if len(cells) == 2 and all(_SCORE.match(c) for c in cells):
            status, scores = "final", {"score_home": int(cells[0]), "score_away": int(cells[1])}
        elif len(cells) == 1:
            low = cells[0].lower()
            if (clock := _clock(cells[0])) is not None:
                start = start.replace(hour=clock[0], minute=clock[1])
            elif _TBA.match(cells[0]):
                time_tba = True
            elif "postpon" in low:
                status = "postponed"
            elif "cancel" in low:
                status = "cancelled"
        if time_tba:
            start = datetime(start.year, start.month, start.day, tzinfo=zone)
        league = row.select_one(".sp-event-league")
        us = {"away_program_id": program} if away else {"home_program_id": program}
        them = {"home_name": opponent} if away else {"away_name": opponent}
        out.append(NormalizedEvent(
            source=NAME, source_uid=f"{program}:{start.date().isoformat()}:{opponent.lower()}",
            sport=params["sport"], level=params["level"], gender=params.get("gender"),
            start_at=start, tz=tz, program_id=program, competition=(_plain(league.get_text(" ", strip=True)) or None) if league else None,
            venue=_venue(row), status=status, time_tba=time_tba, url=params["url"], **us, **them, **scores))
    return out


@adapters.register(NAME)
def fetch(params: dict) -> list[NormalizedEvent]:
    http = params.get("_http") or PoliteHttp(max_crawl_delay=params.get("max_crawl_delay", 60))
    return parse_calendar(http.get_text(params["url"]), params)
