"""`internal`: schedules the project already knows how to read, normalised into sport_events. Providers: `gojacks` (SDSU Jackrabbits) and
`visitbrookings` (club teams in the Visit Brookings events feed, see sports/adapters/visitbrookings.py).

provider `gojacks` -- gojacks.com runs on SIDEARM Sports; every sport has a text-only schedule table at /sports/{slug}/schedule/text, parsed
by sports.adapters.sidearm.parse_schedule_page.

params: provider, url (site root, e.g. https://gojacks.com), program (sport_programs id), level (default college),
        sports: {slug: {"sport": <registry sport id>, "gender": <registry gender>}}, optional tz (default America/Chicago).

Robots: through sports.http.PoliteHttp -- robots.txt per host (our user-agent group, else `*`), Crawl-delay honoured in full between
every request (gojacks.com: 30 s), source skipped above max_crawl_delay, a 403 is a no and is not retried.
Facts only: opponent, local date and time, venue, home/away and the score; see notes: sources/gojacks.

A neutral-site game sets neutral_site (we are listed on the home side so the score stays on the right side); a time cell with no
usable time ("TBD", empty) sets time_tba and start_at is local midnight.

A name carrying "(Exhibition)" or "Scrimmage" sets exhibition ("(Exhibition)" is dropped from the name; a scrimmage is an intrasquad game
with no opponent, so its name is kept). Nothing else sets it.

Facts only also means no `raw_data`, no tournament/notes text, no links: the event's `url` stays empty.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from sports import adapters
from sports.http import PoliteHttp, SourceSkipped
from sports.adapters import visitbrookings
from sports.adapters.sidearm import normalize_opponent, parse_schedule_page, parse_time_cell
from sports.models import Fetched, NormalizedEvent

NAME = "internal"
_EXHIBITION = re.compile(r"\(\s*exhibition\s*\)|\bscrimmage\b", re.I)
_EXHIBITION_TAG = re.compile(r"\s*\(\s*exhibition\s*\)", re.I)
_SCORE = re.compile(r"^\s*([WLT])\b[\s,:]*(\d+)\s*[-–]\s*(\d+)")


def parse_result(text: str | None) -> tuple[str, int | None, int | None]:
    """'W 70-7' -> ('final', 70, 7) with OUR score first; 'Postponed'/'Canceled' -> that status; anything else (incl. 'N -') -> scheduled."""
    t = (text or "").strip()
    m = _SCORE.match(t)
    if m:
        return "final", int(m.group(2)), int(m.group(3))
    low = t.lower()
    if "postpon" in low or low.startswith("ppd"):
        return "postponed", None, None
    if "cancel" in low or "canceled" in low:
        return "cancelled", None, None
    return "scheduled", None, None


def _event(rec: dict, slug: str, spec: dict, params: dict) -> NormalizedEvent | None:
    tz = params.get("tz", "America/Chicago")
    if not rec.get("starts_at"):
        return None
    start = datetime.fromisoformat(rec["starts_at"]).astimezone(ZoneInfo(tz))
    cells = rec.get("raw_data") or {}
    time_tba = parse_time_cell(cells.get("time")) is None
    if time_tba:  # the legacy parser's 12:00 is a placeholder; here the day is known and the time is not
        start = datetime(start.year, start.month, start.day, tzinfo=ZoneInfo(tz))
    raw_name = normalize_opponent(rec["opponent"])
    exhibition = bool(_EXHIBITION.search(raw_name))  # only the source's own words; "N -" (no result) says nothing
    opponent = _EXHIBITION_TAG.sub("", raw_name).strip()  # the label is shown from the flag, not from the name; "Scrimmage" stays in a scrimmage's name
    status, ours, theirs = parse_result(rec.get("result"))
    program = params["program"]
    away = (rec.get("home_away") or "") == "away"
    neutral = (rec.get("home_away") or "") == "neutral"
    us = {"home_program_id": program} if not away else {"away_program_id": program}
    them = {"away_name": opponent} if not away else {"home_name": opponent}
    scores: dict = {}
    if ours is not None:
        scores = {"score_away": ours, "score_home": theirs} if away else {"score_home": ours, "score_away": theirs}
    return NormalizedEvent(
        source=NAME, source_uid=f"gojacks:{slug}:{start.date().isoformat()}:{opponent.lower()}",
        sport=spec["sport"], level=params.get("level", "college"), gender=spec.get("gender"),
        start_at=start, tz=tz, program_id=program, venue=(rec.get("venue") or None), status=status,
        time_tba=time_tba, neutral_site=neutral, exhibition=exhibition,
        **us, **them, **scores)


@adapters.register(NAME)
def fetch(params: dict) -> list[NormalizedEvent]:
    provider = params.get("provider")
    if provider not in ("gojacks", "visitbrookings"):
        raise ValueError(f"internal: unknown provider {provider!r}")
    http = params.get("_http") or PoliteHttp(mode=params.get("robots_mode", "standard"), max_crawl_delay=params.get("max_crawl_delay", 60))
    if provider == "visitbrookings":
        return visitbrookings.fetch(params, http)
    root = params["url"].rstrip("/")
    out = Fetched()
    last_error: Exception | None = None
    for slug, spec in params["sports"].items():
        try:
            html = http.get_text(f"{root}/sports/{slug}/schedule/text")
            events = [ev for rec in parse_schedule_page(html, spec["sport"]) if (ev := _event(rec, slug, spec, params)) is not None]
        except SourceSkipped:
            raise  # robots, a 401/403/429 or a Crawl-delay above the limit is a no for the whole source
        except Exception as exc:  # one page that still fails after http's single retry (or does not parse) is skipped; its scope counts as not read
            last_error = exc
            out.unread.append({"program": params["program"], "sport": spec["sport"], "gender": spec.get("gender"), "slug": slug,
                               "reason": f"{type(exc).__name__}: {exc}"})
            continue
        out.extend(events)
    if len(out.unread) == len(params["sports"]) and last_error is not None:
        raise last_error  # nothing was read at all: the source is an error, as before
    return out
