"""Glasgow Life "What's on" listing -> event records (events.sources[] kind
"glasgow_life").

Source: www.glasgowlife.org.uk/whats-on and its ?channel= pages (Glasgow Life
is the council's culture, libraries, museums and sport trust). Verified
2026-10-22: robots.txt allows these paths (it disallows only /app_plugins/,
/bin/, /config/, /install/, /umbraco/, /usync/ and, for the "GLchatbot"
agent, two pages), no bot challenge, no terms-of-use page found (the guessed
terms URLs 404; only /privacy and /cookie-policy exist). The pages are plain
server-rendered HTML with no JSON-LD, iCal or API. So: facts only (title,
date text, venue, the trust's own category label), every record links back to
the trust's own event page, and only the listing pages are read (a handful
of requests, 2 s apart, one run per day) -- the event detail pages, images
and prices are NOT fetched or stored.

The listing is a curated slice (about 41 distinct events across the main page
and the five channel pages), not the trust's full programme; there is no
pagination.

Each card is <article class="swiper-card"> with the event link, an optional
category label (div.card__label) and two div.card__meta lines: the date text
and the venue. The date text comes in three shapes, all parsed here and never
guessed:
    single     "Saturday 31st Oct 2026 11:00am"  (time optional; "7:30pm - 9pm"
               gives an end time)
    range      "Monday 26th Oct - Thursday 31st Dec 2026"  (year or month may
               be given once, at the end)
    recurring  "Every week on Tuesday from 2nd Jun 2026 until 31st Dec 2026",
               "Every month on the 1st Monday from ..."
A date text that matches none of these is skipped (logged), not stored.

Date-only entries are stored as local midnight with no end (single) or with an
end at the following local midnight after the last day (range), which the site
already renders as "All day". Recurring entries store the first date and keep
the recurrence sentence and the until-date in raw_data (no occurrences are
expanded).
"""
from __future__ import annotations

import html as htmllib
import re
import time
from datetime import date, datetime, timedelta
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.text_sanity import is_suspicious

BASE_URL = "https://www.glasgowlife.org.uk/"
REQUEST_DELAY_SECONDS = 2.0
_PAGE_SEPARATOR = b"\n--GLPAGE--\n"

_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_DATE_TOKEN = re.compile(r"(?<![\w])(\d{1,2})(?:st|nd|rd|th)\b(?:\s+([A-Za-z]{3,9})\b)?(?:\s+(\d{4})\b)?")
_TIME_TOKEN = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", re.IGNORECASE)
_RECURRING = re.compile(r"^Every\s+(week|month|fortnight|day)\b", re.IGNORECASE)


def fetch_pages(source_cfg: dict, headers: dict) -> bytes | None:
    urls = source_cfg.get("urls") or ([source_cfg["url"]] if source_cfg.get("url") else [])
    if not urls:
        return None
    pages: list[bytes] = []
    for i, url in enumerate(urls):
        if i:
            time.sleep(REQUEST_DELAY_SECONDS)
        try:
            r = requests.get(url, headers=headers, timeout=30)
            r.raise_for_status()
            pages.append(r.content)
        except Exception as exc:  # noqa: BLE001 -- one channel page must not sink the others
            print(f"    [events:glasgow_life] fel vid hämtning av {url}: {exc}")
    return _PAGE_SEPARATOR.join(pages) if pages else None


def _month(name: str | None) -> int | None:
    return _MONTHS.get(name[:3].lower()) if name else None


def _tokens(text: str) -> list[list]:
    """[day, month|None, year|None] per date token; a missing month/year is
    filled from the next token that has one ("Wed 4th Feb - Wed 23rd Dec 2026")."""
    toks = [[int(m[1]), _month(m[2]), int(m[3]) if m[3] else None] for m in _DATE_TOKEN.finditer(text)]
    for i in range(len(toks) - 2, -1, -1):
        if toks[i][1] is None:
            toks[i][1] = toks[i + 1][1]
        if toks[i][2] is None:
            toks[i][2] = toks[i + 1][2]
    # a start month later in the year than the end month means the start is the previous year
    for i in range(len(toks) - 1):
        a, b = toks[i], toks[i + 1]
        if a[1] and b[1] and a[2] is not None and a[2] == b[2] and a[1] > b[1]:
            a[2] -= 1
    return toks


def _to_date(tok: list) -> date | None:
    if None in tok:
        return None
    try:
        return date(tok[2], tok[1], tok[0])
    except ValueError:
        return None


def _clock(m: re.Match) -> tuple[int, int] | None:
    h, minute, ap = int(m[1]), int(m[2] or 0), m[3].lower()
    if not 1 <= h <= 12 or minute > 59:
        return None
    return (h % 12) + (12 if ap == "pm" else 0), minute


def parse_date_text(text: str, tz: str) -> dict | None:
    """-> {kind, starts_at, ends_at, until?} (ISO strings, local offset) or None."""
    zone = ZoneInfo(tz)
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return None
    iso = lambda d, h=0, m=0: datetime(d.year, d.month, d.day, h, m, tzinfo=zone).isoformat()  # noqa: E731

    if _RECURRING.match(text):
        head, _, tail = text.partition(" from ")
        if not tail:
            return None
        until_split = re.split(r"\buntil\b", tail, maxsplit=1)
        toks = _tokens(tail)
        first = _to_date(toks[0]) if toks else None
        if first is None:
            return None
        out = {"kind": "recurring", "starts_at": iso(first), "ends_at": None, "recurrence": text}
        if len(until_split) == 2:
            until_toks = _tokens(until_split[1])
            until = _to_date(until_toks[0]) if until_toks else None
            if until is None:
                return None
            out["until"] = until.isoformat()
        return out

    toks = _tokens(text)
    if not toks or any(_to_date(t) is None for t in toks):
        return None
    if len(toks) == 1:
        d = _to_date(toks[0])
        times = [c for c in map(_clock, _TIME_TOKEN.finditer(text)) if c]
        if not times:
            return {"kind": "single", "starts_at": iso(d), "ends_at": None}
        out = {"kind": "single", "starts_at": iso(d, *times[0]), "ends_at": None}
        if len(times) > 1 and times[1] > times[0]:
            out["ends_at"] = iso(d, *times[1])
        return out
    if len(toks) == 2:
        a, b = _to_date(toks[0]), _to_date(toks[1])
        if b < a:
            return None
        return {"kind": "range", "starts_at": iso(a), "ends_at": iso(b + timedelta(days=1))}
    return None


def parse_listing(source_name: str, page: bytes, tz: str) -> list[dict]:
    soup = BeautifulSoup(page.decode("utf-8", errors="replace"), "html.parser")
    records = []
    for art in soup.select("article.swiper-card"):
        link = art.select_one("a.card__link[href^='/event/']")
        if not link:
            continue
        title = htmllib.unescape(link.get_text(" ", strip=True))
        metas = [m.get_text(" ", strip=True) for m in art.select(".card__meta")]
        if not title or not metas:
            continue
        if is_suspicious(title):
            print(f"    [events:{source_name}] misstänkt text i titel, hoppar över: {title[:80]!r}")
            continue
        when = parse_date_text(metas[0], tz)
        if when is None:
            print(f"    [events:{source_name}] okänt datumformat, hoppar över: {metas[0]!r} ({title[:50]!r})")
            continue
        venue = metas[1] if len(metas) > 1 and not is_suspicious(metas[1]) else None
        label = art.select_one(".card__label")
        href = link["href"]
        raw = {"uid": href, "date_text": metas[0], "kind": when["kind"],
               "category": label.get_text(" ", strip=True) if label else None}
        for k in ("until", "recurrence"):
            if k in when:
                raw[k] = when[k]
        records.append({
            "title": title,
            "starts_at": when["starts_at"],
            "ends_at": when["ends_at"],
            "venue": venue,
            "source": source_name,
            "url": urljoin(BASE_URL, href),
            "raw_data": raw,
            "content_hash": content_hash("events", source_name, href),
        })
    return records


def parse_pages(source_name: str, combined: bytes, tz: str) -> list[dict]:
    """All fetched listing pages; the same event on several channel pages is
    kept once (first occurrence)."""
    seen: set[str] = set()
    out: list[dict] = []
    for page in combined.split(_PAGE_SEPARATOR):
        if not page.strip():
            continue
        for rec in parse_listing(source_name, page, tz):
            if rec["raw_data"]["uid"] in seen:
                continue
            seen.add(rec["raw_data"]["uid"])
            out.append(rec)
    return out
