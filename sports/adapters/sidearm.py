"""SIDEARM Sports text-only schedule tables (/sports/{slug}/schedule/text): one page -> game dicts. Used by sports/adapters/internal.py.

The text view is a plain semantic HTML <table>, far more stable than the widget-wrapped default view. A football schedule has one year
heading ("2026 Football Schedule"); basketball and volleyball can span two ("2025-26 ..."), where autumn games belong to the first year and
spring games to the second. Times are the program's own zone (Central for SDSU); see parse_time_cell for dual-zone listings.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

# Schedule times are the program's home timezone (Brookings, SD). ZoneInfo, not a fixed offset, so DST across a season is right.
_CENTRAL = ZoneInfo("America/Chicago")

# "2026 Football Schedule" ELLER "2025-26 Men's Basketball Schedule"
_HEADER_YEAR_RE = re.compile(r"(\d{4})(?:-(\d{2}))?\s+\S.*Schedule", re.IGNORECASE)
_DATE_RE = re.compile(r"([A-Za-z]{3})\s+(\d{1,2})")           # "Aug 29 (Sat)"
# One clock token: "7 p.m.", "7:00 p.m.", "1:30 PM", "noon", with an optional zone label right after it ("... CT", "... MT").
_CLOCK_RE = re.compile(r"(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?)(?:\s+([cmep])[sd]?t\b)?", re.IGNORECASE)
# Minutes to add to a labeled zone's clock to get Central time (the program's own zone).
_ZONE_TO_CENTRAL = {"c": 0, "e": -60, "m": 60, "p": 120}


def parse_time_cell(time_str: str | None) -> tuple[int, int] | None:
    """Central (hour, minute) from a schedule's time cell, or None when the cell names no usable time ("TBD", "TBA", "").

    A plain time is Central by the program's convention. A dual-zone listing ("10 a.m. PT / noon CT", "6 p.m. MT / 7 p.m. CT")
    uses the figure labeled CT; if only another zone is labeled it is converted to Central. A conversion that would cross
    midnight is not guessed: None. "noon" and "midnight" are times; "Approximately 2:30 p.m." is 2:30 p.m.
    """
    found = []
    for m in _CLOCK_RE.finditer(time_str or ""):
        word = m.group(1).lower()
        if word == "noon":
            minutes = 12 * 60
        elif word == "midnight":
            minutes = 0
        else:
            hour = int(m.group(2))
            if not 1 <= hour <= 12:
                continue
            minutes = (hour % 12 + (12 if m.group(4).lower() == "p" else 0)) * 60 + int(m.group(3) or 0)
        found.append((minutes, (m.group(5) or "").lower()))
    if not found:
        return None
    pick = next((f for f in found if f[1] == "c"), None) or next((f for f in found if not f[1]), None) or found[0]
    minutes = pick[0] + (_ZONE_TO_CENTRAL[pick[1]] if pick[1] else 0)
    if not 0 <= minutes < 24 * 60:
        return None
    return minutes // 60, minutes % 60


# Ranking-poll tokens a schedule prepends to a ranked opponent's name ("#1 Nebraska", "RV Villanova", "-/RV No. 1 North Dakota State",
# "No. 3 South Dakota"). They change as polls update, so identity (source_uid) is built from the name without them.
_RANK_TOKEN_RE = re.compile(r"^(?:-/RV|RV|#\d+(?:/\d+)?|No\.\s*\d+)\s+", re.IGNORECASE)


def normalize_opponent(raw: str) -> str:
    """Strip leading ranking-poll tokens, repeatedly (a name can carry more
    than one, e.g. "-/RV No. 1 North Dakota State"). Used for identity, not for display."""
    s = raw.strip()
    while True:
        stripped = _RANK_TOKEN_RE.sub("", s, count=1)
        if stripped == s:
            return s
        s = stripped


_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_schedule_page(html: str, sport: str) -> list[dict]:
    """One SIDEARM text schedule page -> game dicts (used by sports/adapters/internal.py)."""
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text()

    base_year, spans_two_years = _season_year(page_text)

    table = soup.find("table")
    if not table:
        return []

    header_cells = table.find_all("th")
    headers = [th.get_text(strip=True).lower() for th in header_cells]
    if not headers:
        return []

    records = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if not cells or len(cells) < len(headers):
            continue
        vals = {headers[i]: cells[i].get_text(strip=True) for i in range(len(headers))}

        opponent = vals.get("opponent")
        if not opponent:
            continue

        starts_at = _parse_datetime(
            vals.get("date", ""), vals.get("time", ""), base_year, spans_two_years
        )
        result_raw = (vals.get("result") or "").strip()
        result = None if result_raw in ("", "-") else result_raw

        records.append({
            "sport": sport,
            "opponent": opponent,
            "home_away": (vals.get("at") or "").lower() or None,
            "starts_at": starts_at,
            "venue": vals.get("location"),
            "result": result,
            "raw_data": vals,
        })
    return records


def _season_year(page_text: str) -> tuple[int, bool]:
    """Läs ut säsongens basår ur rubriken. Returnerar (basår, spänner_två_år)."""
    m = _HEADER_YEAR_RE.search(page_text)
    if not m:
        return date.today().year, False
    base_year = int(m.group(1))
    spans_two_years = m.group(2) is not None  # t.ex. "2025-26"
    return base_year, spans_two_years


def _parse_datetime(date_str: str, time_str: str, base_year: int,
                    spans_two_years: bool) -> str | None:
    """Returns a tz-AWARE ISO string (Central, DST-correct) -- see module
    docstring for the bug this fixes (previously naive, silently treated as
    UTC by Postgres on insert, ~5-6h off for every game)."""
    m = _DATE_RE.search(date_str)
    if not m:
        return None
    month = _MONTHS.get(m.group(1).lower())
    if not month:
        return None
    day = int(m.group(2))

    # säsong över årsskiftet: jan-jun hör till basår+1, jul-dec till basår.
    year = base_year + 1 if (spans_two_years and month <= 6) else base_year

    # "TBD"/empty gets a 12:00 placeholder here; the adapter reads the raw time cell and marks the game time_tba instead.
    hour, minute = parse_time_cell(time_str) or (12, 0)
    try:
        return datetime(year, month, day, hour, minute, tzinfo=_CENTRAL).isoformat()
    except ValueError:
        return None
