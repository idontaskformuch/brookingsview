"""SDSU Jackrabbits — scheman + resultat via SIDEARM Sports text-only schematabeller.

gojacks.com körs på SIDEARM Sports (bekräftat: sidearmdev.com-CDN, sidearmsports.com
i footern). Varje sports schemasida har en tillgänglighetsanpassad "text only"-vy
(/sports/{slug}/schedule/text) som levererar en ren, semantisk HTML-<table> —
mycket stabilare att skrapa än standardvyn (som lindar samma data i JS-widgets).

Det här är den viktigaste återbesöks-motorn i hela projektet (se PLAN.md) — SDSU-
sport är samhällsidentitet i en collegestad, och matchdagar driver dagligt återbesök.

Årsberäkning: fotbollsschemat har en enda årtalsrubrik ("2026 Football Schedule").
Basket/volleyboll kan ha en säsong som spänner två kalenderår ("2025-26 ..."), där
höstmatcher hör till första året och vårmatcher till det andra — hanteras explicit
nedan istället för att bara anta samma år för alla rader.

NÄTVERKSBEGRÄNSNING under utveckling: gojacks.com ligger utanför sandlådans
tillåtna domäner, så den här filen är byggd och verifierad mot sidans HTML-struktur
via webbsökning/fetch, men INTE körd live i sandlådan. Kör Stage 2-testet
(--only sdsu_athletics) i din egen miljö och rapportera resultatet.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

BASE = "https://gojacks.com"

# sport-slug -> sports_games.sport-värde. Kan överstyras via config (source_cfg["sports"]).
DEFAULT_SPORTS = {
    "football": "football",
    "mens-basketball": "mbb",
    "womens-basketball": "wbb",
    "womens-volleyball": "volleyball",
}

# "2026 Football Schedule" ELLER "2025-26 Men's Basketball Schedule"
_HEADER_YEAR_RE = re.compile(r"(\d{4})(?:-(\d{2}))?\s+\S.*Schedule", re.IGNORECASE)
_DATE_RE = re.compile(r"([A-Za-z]{3})\s+(\d{1,2})")           # "Aug 29 (Sat)"
_TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)", re.IGNORECASE)

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


class GoJacksParser(BaseParser):
    table = "sports_games"
    platform = "gojacks"

    def _sports(self) -> dict[str, str]:
        return self.source_cfg.get("sports") or DEFAULT_SPORTS

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        pages: dict[str, str] = {}
        for slug in self._sports():
            url = f"{BASE}/sports/{slug}/schedule/text"
            r = requests.get(url, headers=self._headers(), timeout=20)
            r.raise_for_status()
            pages[slug] = r.text

        # spara på instansen för parse() (samma mönster som civicengage_pdf_v1,
        # se den filens docstring för varför fetch/parse delar state här)
        self._pages = pages

        # snapshot: alla sidor konkatenerade med tydliga separatorer, så vi har
        # full proveniens för samtliga schemasidor i en enda rad.
        blob = "\n<!--PAGEBREAK-->\n".join(f"<!--{k}-->\n{v}" for k, v in pages.items())
        return FetchResult(raw=blob.encode("utf-8"), content_type="text/html",
                           url=f"{BASE}/sports/*/schedule/text", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        pages = getattr(self, "_pages", None)
        if pages is None:
            # rekonstruera från lagrad snapshot om vi någon gång kör parse() separat
            pages = {}
            blob = fetched.raw.decode("utf-8")
            for chunk in blob.split("<!--PAGEBREAK-->"):
                m = re.match(r"<!--(.*?)-->\n(.*)", chunk.strip("\n"), re.DOTALL)
                if m:
                    pages[m.group(1)] = m.group(2)

        sports_map = self._sports()
        out: list[dict] = []
        for slug, html in pages.items():
            sport = sports_map.get(slug, slug)
            out.extend(self._parse_sport_page(html, sport))
        return out

    def _parse_sport_page(self, html: str, sport: str) -> list[dict]:
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
                "content_hash": content_hash(
                    "gojacks", sport, opponent, vals.get("date"), base_year
                ),
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
    m = _DATE_RE.search(date_str)
    if not m:
        return None
    month = _MONTHS.get(m.group(1).lower())
    if not month:
        return None
    day = int(m.group(2))

    # säsong över årsskiftet: jan-jun hör till basår+1, jul-dec till basår.
    year = base_year + 1 if (spans_two_years and month <= 6) else base_year

    hour, minute = 12, 0  # rimlig default när tiden är "TBA"
    tm = _TIME_RE.search(time_str or "")
    if tm:
        hour = int(tm.group(1)) % 12
        minute = int(tm.group(2) or 0)
        if tm.group(3).lower().startswith("p"):
            hour += 12

    try:
        return datetime(year, month, day, hour, minute).isoformat()
    except ValueError:
        return None
