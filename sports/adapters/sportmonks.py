"""`sportmonks`: the Scottish Premiership (Glasgow) from the Sportmonks Football API v3, normalised into sport_events.

params: url (https://api.sportmonks.com/v3/football/fixtures/between, preflighted by the runner), program (sport_programs id, the league),
        league_id (default 501), competition (shown name), sport (default "soccer"), level (default "pro"), gender (default "men"),
        tz (default Europe/London), days_back (30), days_forward (90).

One request per page of `fixtures/between/{from}/{to}?include=participants;venue;scores;state&filters=fixtureLeagues:{league}`, 50 fixtures a page,
at most MAX_PAGES pages per run. The free plan allows 180 requests an hour per entity (`rate_limit.remaining` in every answer); the run stops
asking when that count is at or below RATE_RESERVE and then reports the league as not read, so nothing is withdrawn on a partial window.

`starting_at` is UTC ("2026-10-28 19:45:00"); start_at is converted to Europe/London. State TBA = no kick-off time (time_tba, local midnight).
A live state is stored as scheduled with no score (we have no live data; the page works out "In progress" from the clock, like every sport).
FT/AET/FT_PEN/AWARDED/WO = final with the full-time score (the CURRENT entry); POSTPONED/SUSPENDED/INTERRUPTED/ABANDONED = postponed, CANCELLED
= cancelled; any other state, a placeholder fixture, or a final fixture without a score is not guessed -- it is left out and reported as unread.

Facts only: team names, kick-off, venue name, status, score. No logos or photos (image_path is never read), no odds flags, no raw payload, no link.

Auth: the token goes in the Authorization header from SPORTMONKS_API_KEY, never in a URL, a log or an error text.
Robots: api.sportmonks.com/robots.txt allows everything (checked 2026-11-09); still read through sports.http.PoliteHttp. A 401/403/429 is a no.
Terms (written answer, ticket Sportmonks-114845, 2026-11-08; .claude/sources/sportmonks.md): ad-funded display and caching are allowed; raw data
must NOT be redistributed -- config/sports.json `noRedistribution` lists this source, so an ICS/JSON/RSS export must never include it.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sports import adapters
from sports.http import PoliteHttp
from sports.models import Fetched, NormalizedEvent

NAME = "sportmonks"
PER_PAGE = 50
MAX_PAGES = 12
RATE_RESERVE = 30  # of the 180 requests an hour; other jobs share the entity
INCLUDES = "participants;venue;scores;state"

STATUS = {
    "NS": "scheduled", "TBA": "scheduled", "PENDING": "scheduled", "DELAYED": "scheduled",
    "INPLAY_1ST_HALF": "scheduled", "HT": "scheduled", "INPLAY_2ND_HALF": "scheduled", "BREAK": "scheduled", "INPLAY_ET": "scheduled",
    "INPLAY_ET_2ND_HALF": "scheduled", "INPLAY_PENALTIES": "scheduled", "EXTRA_TIME_BREAK": "scheduled", "PEN_BREAK": "scheduled",
    "FT": "final", "AET": "final", "FT_PEN": "final", "AWARDED": "final", "WO": "final",
    "POSTPONED": "postponed", "SUSPENDED": "postponed", "INTERRUPTED": "postponed", "ABANDONED": "postponed",
    "CANCELLED": "cancelled",
}


def full_time_goals(scores: list[dict] | None) -> dict[str, int]:
    """{"home": n, "away": n} from the CURRENT entries (the running/full-time score), or {} when there are none."""
    out: dict[str, int] = {}
    for s in scores or []:
        if s.get("description") == "CURRENT":
            side = (s.get("score") or {}).get("participant")
            goals = (s.get("score") or {}).get("goals")
            if side in ("home", "away") and isinstance(goals, int) and not isinstance(goals, bool):
                out[side] = goals
    return out


def _parse_utc(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


class FixtureNotUsable(Exception):
    """A fixture we will not guess about; the text says why."""


def to_event(fx: dict, params: dict) -> NormalizedEvent:
    tz = params.get("tz", "Europe/London")
    if fx.get("placeholder"):
        raise FixtureNotUsable("placeholder fixture")
    state = (fx.get("state") or {}).get("developer_name")
    status = STATUS.get(state)
    if status is None:
        raise FixtureNotUsable(f"unknown state {state!r}")
    sides = {(p.get("meta") or {}).get("location"): p for p in fx.get("participants") or []}
    if "home" not in sides or "away" not in sides or not sides["home"].get("name") or not sides["away"].get("name"):
        raise FixtureNotUsable("no home/away teams")
    try:
        start = _parse_utc(fx["starting_at"]).astimezone(ZoneInfo(tz))
    except (KeyError, TypeError, ValueError):
        raise FixtureNotUsable("no usable starting_at") from None
    time_tba = state == "TBA"
    if time_tba:
        start = datetime(start.year, start.month, start.day, tzinfo=ZoneInfo(tz))
    score: dict = {}
    if status == "final":
        goals = full_time_goals(fx.get("scores"))
        if set(goals) != {"home", "away"}:
            raise FixtureNotUsable("final without a full-time score")
        score = {"score_home": goals["home"], "score_away": goals["away"]}
    venue = (fx.get("venue") or {}).get("name") or None
    return NormalizedEvent(
        source=NAME, source_uid=f"sportmonks:{fx['id']}", sport=params.get("sport", "soccer"), level=params.get("level", "pro"),
        gender=params.get("gender", "men"), competition=params.get("competition"), start_at=start, tz=tz, program_id=params["program"],
        home_name=sides["home"]["name"], away_name=sides["away"]["name"], venue=venue, status=status, time_tba=time_tba, **score)


def _token() -> str:
    key = os.environ.get("SPORTMONKS_API_KEY")
    if not key:
        raise RuntimeError("SPORTMONKS_API_KEY is not set")
    return key


def _page(http: PoliteHttp, params: dict, start: date, end: date, page: int) -> dict:
    url = (f"{params['url'].rstrip('/')}/{start}/{end}?include={INCLUDES}&filters=fixtureLeagues:{int(params.get('league_id', 501))}"
           f"&per_page={PER_PAGE}&page={page}")
    doc = json.loads(http.get_text(url, {"Authorization": _token(), "Accept": "application/json"}))
    if not isinstance(doc, dict):
        raise RuntimeError("Sportmonks: unknown answer shape (not an object)")
    if "data" not in doc and "No result" in str(doc.get("message", "")):
        return {"data": [], "pagination": {"has_more": False}, "rate_limit": doc.get("rate_limit")}
    if not isinstance(doc.get("data"), list):
        raise RuntimeError("Sportmonks: unknown answer shape (no data list)")
    return doc


@adapters.register(NAME)
def fetch(params: dict, today: date | None = None) -> Fetched:
    http = params.get("_http") or PoliteHttp()
    today = today or datetime.now(timezone.utc).date()
    start, end = today - timedelta(days=params.get("days_back", 30)), today + timedelta(days=params.get("days_forward", 90))
    scope = {"program": params["program"], "sport": params.get("sport", "soccer"), "gender": params.get("gender", "men"), "slug": "fixtures"}
    seen: dict = {}
    out = Fetched()
    unread = out.unread
    for page in range(1, MAX_PAGES + 1):
        doc = _page(http, params, start, end, page)
        for fx in doc["data"]:
            if isinstance(fx, dict) and "id" in fx:
                seen[fx["id"]] = fx
        pagination = doc.get("pagination") or {}
        if not pagination.get("has_more"):
            break
        remaining = (doc.get("rate_limit") or {}).get("remaining")
        if page == MAX_PAGES or (isinstance(remaining, int) and remaining <= RATE_RESERVE):
            unread.append({**scope, "reason": f"stopped after {page} page(s): " + ("request budget" if page < MAX_PAGES else "page limit")})
            break
    for fx_id, fx in seen.items():
        try:
            out.append(to_event(fx, params))
        except FixtureNotUsable as exc:
            unread.append({**scope, "slug": f"fixture {fx_id}", "reason": str(exc)})
    return out
