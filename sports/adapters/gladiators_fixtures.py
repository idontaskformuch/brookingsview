"""`gladiators_fixtures`: Caledonia Gladiators' fixtures page (Elementor), one per team, read from the server HTML.

First user: caledoniagladiators.com/mens-fixtures/ and /womens-fixtures/ (sports-deep S3, owner 2026-11-15 v4, built 2026-11-27).
Each game is one div.fixture-wrap (class is-home-fixture / is-away-fixture), drawn three times for desktop/tablet/mobile; only its first
variant is read. Its h2 headings, in order:
  upcoming   "15/11/2026", "4:00 pm", "<title>", "<home>", "VS", "<away>", "<home> — Home Game" | "<home> — <arena>"
  played     "win"|"lose", "08/11/2026", "<title>", "<home score>", "<home>", "VS", "<away score>", "<away>", "<home> — TBC"
The title ("Caledonia Gladiators (M) – Liverpool – 08/11/2026") always names the Gladiators first and is not used for home/away; the order
around "VS" is home first, and the score before "VS" belongs to the home side.

params: url, program, team (as the page writes it: "Caledonia Gladiators (M)" / "(W)"), sport, level, gender, optional tz.

A played game carries no time on the page: it is time_tba with keep_known_time, so a clock time stored while it was upcoming stays
(sports/store.py). "Home Game" and "TBC" give venue None (the site falls back to the program's home_venue, sports/venues.py); any other
text after the dash is the arena the page names. A game whose two sides do not include `team` is left alone, and so is an unfinished
CMS entry ("please-select"). An upcoming game with no time on the page is time_tba. A page with no fixture-wrap
raises: a changed layout is an error, not an empty season.

Robots: through sports.http.PoliteHttp. caledoniagladiators.com robots.txt read 2026-11-15 (fetch-ledger): fixtures pages allowed.
ToS: no terms page (page-sitemap has only privacy and cookie policies; notes/sports-deep-phase2-reading-2026-11-15.md). Facts and a link
back only: date, time, sides, arena, score. No logos.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from sports import adapters
from sports.http import PoliteHttp
from sports.models import NormalizedEvent

NAME = "gladiators_fixtures"
_DATE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$", re.I)
_SCORE = re.compile(r"^\d+$")
_NO_VENUE = {"home game", "tbc", "tba", "tbd"}


def _plain(text: str) -> str:
    return " ".join(text.replace("’", "'").split())


def _headings(wrap) -> list[str]:
    first = next(iter(wrap.find_all(recursive=False)), wrap)
    return [t for t in (_plain(h.get_text(" ", strip=True)) for h in first.find_all("h2")) if t]


def parse_fixtures(html: str, params: dict) -> list[NormalizedEvent]:
    wraps = BeautifulSoup(html, "html.parser").select("div.fixture-wrap")
    if not wraps:
        raise ValueError("no fixture-wrap on the page")
    tz = params.get("tz", "Europe/London")
    zone = ZoneInfo(tz)
    team = _plain(params["team"]).lower()
    program = params["program"]
    out: list[NormalizedEvent] = []
    for wrap in wraps:
        hs = _headings(wrap)
        # an unfinished CMS entry (real rows 2026-11-27: "please-select", "03/04/2026", "Auto Draft", "London Lions", "VS", ... with no
        # result; women 17/05/2026): not a game. "Auto Draft" alone is NOT the marker: played games carry it as their title with a real
        # result (women 10/05/2026 "win", 80-58 Essex Rebels), and 12 women's games have no title heading at all.
        if "VS" not in hs or "please-select" in hs:
            continue
        vs = hs.index("VS")
        day = next((m for m in (_DATE.match(h) for h in hs) if m), None)
        if day is None:
            continue
        before = [h for h in hs[:vs] if not _DATE.match(h) and not _CLOCK.match(h) and " – " not in h and h.lower() not in ("win", "lose")]
        after = [h for h in hs[vs + 1:] if " — " not in h]
        home_name = next((h for h in reversed(before) if not _SCORE.match(h)), None)
        away_name = next((h for h in after if not _SCORE.match(h)), None)
        if not home_name or not away_name or team not in (home_name.lower(), away_name.lower()):
            continue
        home_score = next((h for h in reversed(before) if _SCORE.match(h)), None)
        away_score = next((h for h in after if _SCORE.match(h)), None)
        clock = next((m for m in (_CLOCK.match(h) for h in hs) if m), None)
        d = datetime(int(day.group(3)), int(day.group(2)), int(day.group(1)), tzinfo=zone)
        if clock:
            start, time_tba = d.replace(hour=int(clock.group(1)) % 12 + (12 if clock.group(3).lower() == "p" else 0), minute=int(clock.group(2))), False
        else:
            start, time_tba = d, True
        venue_line = next((h for h in hs if " — " in h), "")
        venue = venue_line.split(" — ", 1)[1].strip() if " — " in venue_line else ""
        played = home_score is not None and away_score is not None
        home = home_name.lower() == team
        opponent = away_name if home else home_name
        out.append(NormalizedEvent(
            source=NAME, source_uid=f"{program}:{d.date().isoformat()}:{opponent.lower()}",
            sport=params["sport"], level=params["level"], gender=params.get("gender"), start_at=start, tz=tz, program_id=program,
            venue=None if venue.lower() in _NO_VENUE or not venue else venue,
            status="final" if played else "scheduled", time_tba=time_tba, keep_known_time=time_tba and played, url=params["url"],
            **({"home_program_id": program, "away_name": opponent} if home else {"home_name": opponent, "away_program_id": program}),
            **({"score_home": int(home_score), "score_away": int(away_score)} if played else {})))
    return out


@adapters.register(NAME)
def fetch(params: dict) -> list[NormalizedEvent]:
    http = params.get("_http") or PoliteHttp(max_crawl_delay=params.get("max_crawl_delay", 60))
    return parse_fixtures(http.get_text(params["url"]), params)
