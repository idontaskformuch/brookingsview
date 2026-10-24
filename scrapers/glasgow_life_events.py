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
the trust's own event page. Images are NOT fetched or stored.

Detail pages (added 2026-10-24): the listing card carries only title, date and
venue, so the writer had nothing to base a summary on and padded it with
plausible-sounding sentences that the incoherent_fragments gate (rightly)
rejected -- 19 of the ~40 new occurrences never got a story. Each distinct event
page (about 40, 2 s apart, once per daily run; robots.txt allows /event/) is now
read once for its own description paragraphs plus the "Tickets" and "Age"
lines, stored as raw_data.description / .tickets / .age. Only those three
fields are kept, never the page.

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
already renders as "All day". Recurring entries used to store only the first date (a start in 2025 or
earlier, so a whole series sat in the past and /events/ looked empty). Since
2026-10-24 (owner) a recurring series is EXPANDED into its occurrences in the
next EXPAND_DAYS days (30) -- "Every week on <weekday>" and "Every month on the
<nth> <weekday>" -- one record per occurrence (date only: the listing gives no
time for a series, so it renders as "All day"), each linking to the series page
and keeping the sentence in raw_data. A recurrence that matches neither shape is
kept as the single first-date record, exactly as before. The window rolls forward
with each daily run.
"""
from __future__ import annotations

import html as htmllib
import json
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
_DETAIL_MARKER = b"--GLDETAIL--\n"
MAX_DESCRIPTION_CHARS = 1200

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
    if not pages:
        return None
    details = _fetch_details(pages, headers) if source_cfg.get("detail_pages", False) else {}
    if details:
        pages.append(_DETAIL_MARKER + json.dumps(details, ensure_ascii=False).encode("utf-8"))
    return _PAGE_SEPARATOR.join(pages)


def _fetch_details(pages: list[bytes], headers: dict) -> dict[str, dict]:
    """href -> parse_detail() for every distinct event link on the listing pages.
    A page that fails is simply absent (that event keeps the thin listing facts)."""
    hrefs: list[str] = []
    for page in pages:
        soup = BeautifulSoup(page.decode("utf-8", errors="replace"), "html.parser")
        for a in soup.select("article.swiper-card a.card__link[href^='/event/']"):
            if a["href"] not in hrefs:
                hrefs.append(a["href"])
    out: dict[str, dict] = {}
    for href in hrefs:
        time.sleep(REQUEST_DELAY_SECONDS)
        try:
            r = requests.get(urljoin(BASE_URL, href), headers=headers, timeout=30)
            r.raise_for_status()
        except Exception as exc:  # noqa: BLE001 -- one detail page must not sink the others
            print(f"    [events:glasgow_life] fel vid hämtning av {href}: {exc}")
            continue
        detail = parse_detail(r.content)
        if detail:
            out[href] = detail
    return out


def parse_detail(page: bytes) -> dict:
    """{"description", "tickets", "age"} from one event page; keys with no (or
    garbled) text are left out. Description = the page's own article paragraphs,
    cut at a sentence/word boundary."""
    soup = BeautifulSoup(page.decode("utf-8", errors="replace"), "html.parser")
    out: dict[str, str] = {}
    paras = [" ".join(p.get_text(" ", strip=True).split()) for p in soup.select("div.editor--article p")]
    text = " ".join(t for t in paras if t)
    if len(text) > MAX_DESCRIPTION_CHARS:
        cut = text[:MAX_DESCRIPTION_CHARS]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        text = cut[:end + 1] if end > MAX_DESCRIPTION_CHARS // 2 else cut.rsplit(" ", 1)[0]
    if text and not is_suspicious(text):
        out["description"] = text
    for item in soup.select(".event-details__item"):
        label = item.select_one("dt")
        value = item.select_one("dd")
        if not label or not value:
            continue
        key = {"tickets": "tickets", "age": "age"}.get(label.get_text(" ", strip=True).lower())
        val = " ".join(value.get_text(" ", strip=True).split())[:200]
        if key and val and not is_suspicious(val):
            out[key] = val
    return out


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


def parse_listing(source_name: str, page: bytes, tz: str, details: dict | None = None) -> list[dict]:
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
        raw.update((details or {}).get(href, {}))
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


EXPAND_DAYS = 30
_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
_WEEKLY = re.compile(r"^Every week on (\w+)", re.IGNORECASE)
_MONTHLY = re.compile(r"^Every month on the (\d)(?:st|nd|rd|th) (\w+)", re.IGNORECASE)


def _nth_weekday(year: int, month: int, nth: int, weekday: int) -> date | None:
    first = date(year, month, 1)
    d = first + timedelta(days=(weekday - first.weekday()) % 7)
    d += timedelta(weeks=nth - 1)
    return d if d.month == month else None


def occurrences(recurrence: str, first: date, until: date | None, today: date, days: int = EXPAND_DAYS) -> list[date] | None:
    """Dates of a recurring series inside [today, today+days], never before `first`, never after `until`.
    None when the sentence is not one of the two supported shapes (the caller then keeps the plain series record)."""
    lo, hi = max(first, today), today + timedelta(days=days)
    if until is not None:
        hi = min(hi, until)
    m = _WEEKLY.match(recurrence.strip())
    if m and m.group(1).lower() in _WEEKDAYS:
        wd = _WEEKDAYS[m.group(1).lower()]
        d = lo + timedelta(days=(wd - lo.weekday()) % 7)
        out = []
        while d <= hi:
            out.append(d)
            d += timedelta(weeks=1)
        return out
    m = _MONTHLY.match(recurrence.strip())
    if m and m.group(2).lower() in _WEEKDAYS:
        nth, wd = int(m.group(1)), _WEEKDAYS[m.group(2).lower()]
        out = []
        y, mo = lo.year, lo.month
        while date(y, mo, 1) <= hi:
            d = _nth_weekday(y, mo, nth, wd)
            if d is not None and lo <= d <= hi:
                out.append(d)
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
        return out
    return None


def expand_recurring(rec: dict, tz: str, today: date) -> list[dict]:
    """A recurring series record -> one record per occurrence in the next EXPAND_DAYS days; any other record unchanged."""
    raw = rec["raw_data"]
    if raw.get("kind") != "recurring":
        return [rec]
    first = datetime.fromisoformat(rec["starts_at"]).date()
    until = date.fromisoformat(raw["until"]) if raw.get("until") else None
    days = occurrences(raw.get("recurrence") or raw["date_text"], first, until, today)
    if days is None:
        return [rec]
    zone = ZoneInfo(tz)
    out = []
    for d in days:
        r = dict(rec)
        r["starts_at"] = datetime(d.year, d.month, d.day, tzinfo=zone).isoformat()
        r["ends_at"] = None
        r["raw_data"] = {**raw, "kind": "recurring_occurrence", "series_uid": raw["uid"], "occurrence_date": d.isoformat()}
        r["content_hash"] = content_hash("events", rec["source"], raw["uid"], d.isoformat())
        out.append(r)
    return out


def parse_pages(source_name: str, combined: bytes, tz: str, today: date | None = None) -> list[dict]:
    """All fetched listing pages; the same event on several channel pages is
    kept once (first occurrence). Recurring series become their next occurrences.
    The trailing detail section (see fetch_pages) adds description/tickets/age."""
    today = today or datetime.now(ZoneInfo(tz)).date()
    details: dict = {}
    pages = []
    for page in combined.split(_PAGE_SEPARATOR):
        if page.startswith(_DETAIL_MARKER):
            try:
                details = json.loads(page[len(_DETAIL_MARKER):].decode("utf-8"))
            except ValueError:
                print("    [events:glasgow_life] detaljavsnittet gick inte att läsa, hoppar över")
        else:
            pages.append(page)
    seen: set[str] = set()
    out: list[dict] = []
    for page in pages:
        for rec in parse_listing(source_name, page, tz, details):
            if rec["raw_data"]["uid"] in seen:
                continue
            seen.add(rec["raw_data"]["uid"])
            out.extend(expand_recurring(rec, tz, today))
    return out
