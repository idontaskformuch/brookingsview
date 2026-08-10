"""SDSU:s publika evenemangskalender (sdstate.edu/event-calendar) --
Brookings-specifik, se configs/brookings_sd.json:s "sdsu_events"-block.

KÄLLA: Drupal 11, helt server-renderad (ingen JS krävs), sidnumrerad via
?page=N (0-indexerad, 10 poster/sida), kategorifiltrerad via upprepade
category[ID]=ID-parametrar (bekräftat: fungerar både enskilt och
kombinerat som ETT ELLER-filter -- ?category[10881]=10881&category[10921]=10921
gav färre träffar än totalen men fler än en ensam kategori). Inget behov av
att hämta enskilda eventsidor -- kalenderlistan innehåller redan titel,
datum/tid, plats, kort teaser, kategori(er) och URL för varje event, se
_parse_events().

ROBOTS.TXT (verifierat 2026-08-10, live på sdstate.edu/robots.txt):
User-agent: * tillåter /event-calendar och /events/ (ingen Disallow-regel
träffar dem). ClaudeBot/anthropic-ai/Claude-Web är DÄREMOT uttryckligen
begränsade till /admissions//academics//news//programs/ (Disallow: / för
allt annat) -- men det gäller bara om anropet IDENTIFIERAR SIG som just de
namnen. Den här skrapan kör (som alla andra i den här kodbasen) under
projektets egen, ärliga User-Agent (USER_AGENT-miljövariabeln,
"brookingsview.com (kontakt: ...)"), som inte nämns alls i robots.txt och
därför faller under den generella "User-agent: *"-regeln -- INTE en
kringgående av ClaudeBot-spärren (jämför ESPN-resonemanget i
regional_sports_v1.py, där just avsiktligt UTELÄMNAD identifiering var
problemet; här är identifieringen densamma som resten av pipelinen alltid
använder, bara inte namnet "ClaudeBot").

KATEGORIER (alla 12 kategori-ID:n lästa av live 2026-08-10 från
kryssrutorna på kalendersidan): bara de fem som en vanlig läsare (inte en
SDSU-anställd) bryr sig om skrapas, se CATEGORY_WHITELIST. Uttryckligen
UTE: Workshops/Training (10941), Meetings (10916), Academic (10871),
Admissions (10876), Career/Job Fairs (10891) -- internt/administrativt
brus. Health/Wellness (10906) och Lectures/Speakers (10911) fanns som
kategorier men stod inte med i den ursprungliga prioriteringslistan --
lämnade utanför tills vidare, lätt att lägga till (bara ett ID i dicten).

SIDGRÄNS: ~233 events matchar whitelisten av totalt ~481 -- listan är
redan datumsorterad stigande (dagens datum -> framåt), så bara de första
sidorna (max_pages i configen) hämtas. "This week/coming up"-vyerna behöver
inte events sex månader fram, och en lägre gräns håller nere antalet
HTTP-anrop mot en källa utan egen nyckel/kvot men ändå värd att vara
sansad mot.

DEDUP/UPPDATERING: ett event kan legitimt uppdateras (ändrad tid, inställt,
ny lokal) för SAMMA post -- samma resonemang som regional_sports_v1.py,
till skillnad från t.ex. jobs_v1.py (append-only).
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

_BASE_URL = "https://www.sdstate.edu/event-calendar"
_RESULTS_PER_PAGE = 10

# label -> kategori-ID, läst live av kryssrutorna på /event-calendar
# 2026-08-10 (edit-category-<ID>). Bara de fem som är reader-facing tas med
# -- se moduldocstring för de uteslutna.
CATEGORY_WHITELIST: dict[str, str] = {
    "10881": "Athletics",
    "10921": "Music",
    "10931": "Special Events",
    "10936": "Theatre/Dance",
    "10896": "Camps/Conferences",
}

_SD_TZ = ZoneInfo("America/Chicago")

_MONTH_DAY_RE = re.compile(r"^[A-Za-z]{3}$")


class SdsuEventsParser(BaseParser):
    table = "sdsu_events"
    platform = "sdsu_event_calendar"
    # Se moduldocstring: ett event uppdateras (tid/lokal/inställt) för SAMMA
    # post i stället för att vara oföränderlig källdata.
    conflict_columns = ("town_id", "external_event_id")
    update_columns = ["title", "teaser", "location", "starts_at", "ends_at",
                       "categories", "primary_category", "raw_data", "content_hash"]

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        max_pages = int(self.source_cfg.get("max_pages", 6))
        category_params = [("category[%s]" % cid, cid) for cid in CATEGORY_WHITELIST]

        pages_html: list[str] = []
        for page in range(max_pages):
            params = list(category_params) + [("page", str(page))]
            r = requests.get(_BASE_URL, params=params, headers=self._headers(), timeout=20)
            r.raise_for_status()
            pages_html.append(r.text)
            if len(_extract_event_blocks(r.text)) < _RESULTS_PER_PAGE:
                break  # sista sidan

        self._pages_html = pages_html
        raw = "\n<!-- PAGE BREAK -->\n".join(pages_html).encode("utf-8")
        return FetchResult(raw=raw, content_type="text/html",
                           url=f"{_BASE_URL}?{'&'.join(f'{k}={v}' for k, v in category_params)}",
                           http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        pages_html = getattr(self, "_pages_html", None)
        if pages_html is None:
            pages_html = fetched.raw.decode("utf-8").split("\n<!-- PAGE BREAK -->\n")

        rows: list[dict] = []
        seen_ids: set[str] = set()
        for html in pages_html:
            for block in _extract_event_blocks(html):
                row = _parse_event_block(block)
                if row and row["external_event_id"] not in seen_ids:
                    seen_ids.add(row["external_event_id"])
                    rows.append(row)
        return rows


def _extract_event_blocks(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    return soup.select("div.event-calendar-event")


def _parse_event_block(block) -> dict | None:
    link_el = block.select_one(".sds-ec__date-item--title a")
    if not link_el or not link_el.get("href"):
        return None
    href = link_el["href"]
    title = link_el.get_text(" ", strip=True)

    # "/events/2026/08/home-soccer" -- året finns bara i URL:en, inte i
    # datumblocket (som bara visar "Aug" + "10", ingen årtal-siffra).
    m = re.match(r"^/events/(\d{4})/(\d{2})/", href)
    if not m:
        return None
    year = int(m.group(1))

    month_el = block.select_one(".sds-ec__date-item--month")
    day_el = block.select_one(".sds-ec__date-item--day")
    month_txt = month_el.get_text(strip=True) if month_el else None
    day_txt = day_el.get_text(strip=True) if day_el else None

    time_el = block.select_one(".sds-ec__date-item--time")
    time_txt = re.sub(r"\s+", " ", time_el.get_text(" ", strip=True)) if time_el else ""
    starts_at, ends_at, location = _parse_time_block(time_txt, year, month_txt, day_txt)

    body_el = block.select_one(".sds-ec__date-item--body")
    teaser = body_el.get_text(" ", strip=True) if body_el else ""

    categories = [a.get_text(strip=True) for a in block.select(".sds-ec__date-item--tags a")]
    primary_category = next((c for c in categories if c in CATEGORY_WHITELIST.values()), None)

    # VIKTIGT: URL:en ensam är INTE ett stabilt dedup-nyckel -- verifierat
    # live 2026-08-10 att SDSU återanvänder samma slug (t.ex.
    # "/events/2026/08/home-soccer") som generisk landningssida för FLERA
    # olika matcher på olika datum ("Soccer vs Manitoba" 13 aug, "Soccer vs
    # Moorhead" 16 aug, ...). Sluggen + starttid tillsammans identifierar
    # den faktiska förekomsten, precis som spec-dokumentet förutsåg
    # ("date+title if URL isn't stable across recurring instances").
    occurrence_key = f"{href}#{starts_at.isoformat() if starts_at else day_txt}"

    return {
        "external_event_id": occurrence_key,
        "title": title,
        "teaser": teaser or None,
        "location": location,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "categories": categories,
        "primary_category": primary_category,
        "event_url": f"https://www.sdstate.edu{href}",
        "source": "sdsu_event_calendar",
        "raw_data": {"title": title, "time_text": time_txt, "teaser": teaser, "categories": categories},
        "content_hash": content_hash("sdsu_event", occurrence_key, title, time_txt, location),
    }


def _parse_time_block(time_txt: str, year: int, month_txt: str | None, day_txt: str | None):
    """"7:00 p.m. - 9:00 p.m., Outdoor Areas — Athletics" -> (starts_at, ends_at, location).

    Platsen är ALLT efter det sista kommat -- kan i sig innehålla ett
    bindestreck (t.ex. "Outdoor Areas — Athletics"), så delningen görs på
    " - " FÖRE första kommat, inte generellt över hela strängen.
    """
    location = None
    starts_at = ends_at = None

    if "," in time_txt:
        time_part, location = time_txt.split(",", 1)
        location = location.strip() or None
    else:
        time_part = time_txt

    if month_txt and day_txt and _MONTH_DAY_RE.match(month_txt) and day_txt.isdigit():
        parts = [p.strip() for p in time_part.split(" - ")]
        start_str = parts[0] if parts else None
        end_str = parts[1] if len(parts) > 1 else None
        starts_at = _combine(year, month_txt, day_txt, start_str)
        ends_at = _combine(year, month_txt, day_txt, end_str)

    return starts_at, ends_at, location


def _combine(year: int, month_txt: str, day_txt: str, time_str: str | None):
    if not time_str:
        return None
    try:
        clock = datetime.strptime(time_str.replace(".", ""), "%I:%M %p")
    except ValueError:
        return None
    try:
        date_part = datetime.strptime(f"{year} {month_txt} {day_txt}", "%Y %b %d")
    except ValueError:
        return None
    return datetime(date_part.year, date_part.month, date_part.day,
                     clock.hour, clock.minute, tzinfo=_SD_TZ)
