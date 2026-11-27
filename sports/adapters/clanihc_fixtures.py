"""`clanihc_fixtures`: Glasgow Clan's own fixtures and results lists on clanihc.com, read from the server HTML.

First user: clanihc.com/games/fixtures/ + /games/fixtures/page/2/ and /games/results/ (sports-deep S4, owner 2026-11-15 v4, built
2026-11-27). Each game is a div.lg:flex card: a date block ("Wed 25" + "Nov 2026 7:30 pm"; on the results list "Nov 2026" with no time),
then div.grid.grid-cols-9 with two h4 team names, home first, each followed by a div.text-lg score cell (empty until played).
The "Next Game" box at the top (div.grid.grid-cols-3, "Fri 20th 2026" with no month) is never read (owner, spec 1a).

params: url (fixtures page 1), pages (all fixtures pages, in order), results (the results page), program, team ("Glasgow Clan"), sport,
level, gender, optional tz.

The cards name no arena: venue is None, and the site takes the program's home_venue / venue_overrides (sports/venues.py) for home games;
away games show no arena (spec 1a). A game on both lists comes from the results list. Results-list rows have no time: time_tba with
keep_known_time, so the clock time stored while the game was on the fixtures list stays (sports/store.py). A results card without two
scores stays "scheduled" (the source gives no result). A card whose weekday does not match its date is left out. Any page without a
card raises: a changed layout is an error, not an empty season.

Robots: through sports.http.PoliteHttp. clanihc.com robots.txt read 2026-11-15, verbatim "User-agent: * / Disallow: /wp-admin/ / Allow:
/wp-admin/admin-ajax.php" (evidence clanihc-robots.txt), no Crawl-delay. ToS: no terms page in the sitemap (spec answer 7). Elite League's
terms cover only eliteleague.co.uk, which is never read or deep-linked. Facts and a link back only. No logos.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from sports import adapters
from sports.http import PoliteHttp
from sports.models import NormalizedEvent

NAME = "clanihc_fixtures"
_DAY = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(\d{1,2})$", re.I)
_MONTH = re.compile(r"^([A-Za-z]{3})\w*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?$", re.I)
_MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _plain(text: str) -> str:
    return " ".join(text.replace("’", "'").split())


def _cards(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    return [d for d in soup.find_all("div", class_="lg:flex") if d.select_one("div.grid.grid-cols-9") and len(d.find_all("h4")) == 2]


def parse_cards(html: str, params: dict, results: bool) -> list[NormalizedEvent]:
    cards = _cards(html)
    if not cards:
        raise ValueError("no game card on the page")
    tz = params.get("tz", "Europe/London")
    zone = ZoneInfo(tz)
    team = _plain(params["team"]).lower()
    program = params["program"]
    out: list[NormalizedEvent] = []
    for card in cards:
        lines = [_plain(x.get_text(" ", strip=True)) for x in card.find("div").find_all("div") if not x.find("div")]
        day = next((m for m in (_DAY.match(t) for t in lines) if m), None)
        month = next((m for m in (_MONTH.match(t) for t in lines) if m), None)
        if day is None or month is None or month.group(1).lower() not in _MONTHS:
            continue
        d = datetime(int(month.group(2)), _MONTHS[month.group(1).lower()], int(day.group(2)), tzinfo=zone)
        if _WEEKDAYS[d.weekday()] != day.group(1).lower()[:3]:
            continue
        grid = card.select_one("div.grid.grid-cols-9")
        names = [_plain(h.get_text(" ", strip=True)) for h in grid.find_all("h4")]
        if len(names) != 2 or team not in (names[0].lower(), names[1].lower()):
            continue
        scores = [_plain(x.get_text(" ", strip=True)) for x in grid.select("div.text-lg.font-semibold")]
        played = len(scores) == 2 and all(s.isdigit() for s in scores)
        if month.group(3):
            start, time_tba = d.replace(hour=int(month.group(3)) % 12 + (12 if month.group(5).lower() == "p" else 0), minute=int(month.group(4))), False
        else:
            start, time_tba = d, True
        home = names[0].lower() == team
        opponent = names[1] if home else names[0]
        out.append(NormalizedEvent(
            source=NAME, source_uid=f"{program}:{d.date().isoformat()}:{opponent.lower()}",
            sport=params["sport"], level=params["level"], gender=params.get("gender"), start_at=start, tz=tz, program_id=program,
            venue=None, status="final" if played else "scheduled", time_tba=time_tba, keep_known_time=results and time_tba,
            url=params["results"] if results else params["url"],
            **({"home_program_id": program, "away_name": opponent} if home else {"home_name": opponent, "away_program_id": program}),
            **({"score_home": int(scores[0]), "score_away": int(scores[1])} if played else {})))
    return out


def merge(fixtures: list[NormalizedEvent], results: list[NormalizedEvent]) -> list[NormalizedEvent]:
    """One row per game; the results list wins for a game on both, keeping the fixtures list's clock time (the results list has none)."""
    by_uid = {e.source_uid: e for e in fixtures}
    for e in results:
        known = by_uid.get(e.source_uid)
        if known is not None and not known.time_tba and e.time_tba:
            e.start_at, e.time_tba, e.keep_known_time = known.start_at, False, False
        by_uid[e.source_uid] = e
    return sorted(by_uid.values(), key=lambda e: e.start_at)


@adapters.register(NAME)
def fetch(params: dict) -> list[NormalizedEvent]:
    http = params.get("_http") or PoliteHttp(max_crawl_delay=params.get("max_crawl_delay", 60))
    fixtures = [e for url in params.get("pages") or [params["url"]] for e in parse_cards(http.get_text(url), params, results=False)]
    return merge(fixtures, parse_cards(http.get_text(params["results"]), params, results=True))
