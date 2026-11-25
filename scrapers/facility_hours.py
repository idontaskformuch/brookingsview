"""Opening hours read from a town's own pages (owner order D 4, 2026-11-25). Every request goes through PoliteFetcher (robots.txt
first, its Crawl-delay kept, one UA); every parse is deterministic. No page here ever reaches a language model: the Brookings site
and libcal.sdstate.edu name AI crawlers in robots.txt (llm_excluded), and nothing in this module calls one anyway.

    python -m scrapers.facility_hours brookings-catalog             # dry run: what would change
    python -m scrapers.facility_hours brookings-catalog --apply     # write (the facility-hours workflow, first Monday of a month)
    python -m scrapers.facility_hours briggs [--apply]              # Briggs Library from LibCal (the workflow, every Monday)
    python -m scrapers.facility_hours broomfield-departments        # one read per page, report only, never writes

Sources:
  * Brookings facility catalog (CivicPlus, https://www.cityofbrookings-sd.gov/Facilities): every detail page has
    <div class="section hours"><h3>Hours</h3><dl>Sunrise to 11:00p.m.</dl></div>. The list is paged by a POST
    (/Facilities/Facility/Search); PoliteFetcher only makes GET requests and a new request method is the owner's decision
    (19 nov K2), so only what GET reaches is read: list page 1 and the detail pages the places rows already link to.
  * Briggs Library (https://libcal.sdstate.edu/hours): a table per week, one column per date, "7:45am – 12am" or "Closed".
    Read as dated place_hours rows (valid_from = valid_to = that date), so term breaks and holidays are exact.
  * Broomfield departments (police, court, Workforce Center, HHS, Auditorium): their place_hours rows were entered by hand on
    2026-11-13; this reads each page once and reports whether the "Hours" text on it still says the same.

A catalog row only fills a place that has no hours of its own, or one this reader filled before (verification_method
'facility_catalog'); a hand-verified row (city hall, library, Dakota Nature Park) is never overwritten, only reported when
the catalog says something else.
"""
from __future__ import annotations

import html as _html
import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from urllib.parse import urljoin

from ai_pipeline.facility_hours import _normalize, _parse_time_range, parse_hours_text
from scrapers.polite_fetch import PoliteFetcher, Refused

BROOKINGS_CATALOG = "https://www.cityofbrookings-sd.gov/Facilities"
BROOKINGS_DETAIL_RE = re.compile(r"^https://www\.cityofbrookings-sd\.gov/facilities/facility/details/", re.IGNORECASE)
LIBCAL_HOURS = "https://libcal.sdstate.edu/hours"
BRIGGS_SLUG = "briggs-library"
BROOMFIELD_DEPARTMENTS = ("broomfield-police-department", "broomfield-court-services", "broomfield-workforce-center",
                          "broomfield-health-human-services", "broomfield-auditorium")
CATALOG_METHOD = "facility_catalog"
LIBCAL_METHOD = "libcal"
DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


# --- CivicPlus facility catalog ---------------------------------------------------------------------------------------------

def catalog_detail_links(list_html: str, base: str = BROOKINGS_CATALOG) -> list[str]:
    """Detail page URLs on one catalog list page, in page order, each once."""
    seen: list[str] = []
    for href in re.findall(r'href="(/Facilities/Facility/Details/[^"#?]+)"', list_html):
        url = urljoin(base, href)
        if url not in seen:
            seen.append(url)
    return seen


@dataclass
class CatalogEntry:
    url: str
    name: str
    hours_text: str | None


def parse_catalog_detail(detail_html: str, url: str) -> CatalogEntry | None:
    """Name (the address block's <h4>) and the "Hours" section's text, verbatim; None when the page has no name."""
    name_m = re.search(r'<div class="section address">\s*<h4>(.*?)</h4>', detail_html, re.S)
    if not name_m:
        return None
    hours_m = re.search(r'<div class="section hours">.*?<h3>\s*Hours\s*</h3>(.*?)</div>', detail_html, re.S)
    hours = _text(hours_m.group(1)) if hours_m else ""
    return CatalogEntry(url=url, name=_text(name_m.group(1)), hours_text=hours or None)


def name_key(name: str) -> str:
    """"Douglas Chittick Com. Gardens" and "Douglas Chittick Community Gardens" are not made equal here: only case, "&"/"and",
    punctuation and spacing are ignored, so a match is the same name, never a guess."""
    s = name.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# --- LibCal -----------------------------------------------------------------------------------------------------------------

_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _resolve_year(month: int, day: int, reference: date) -> date:
    """LibCal heads a column "Nov 25" without a year: the year that puts the date nearest the day the page was read."""
    candidates = [date(reference.year + dy, month, day) for dy in (-1, 0, 1)]
    return min(candidates, key=lambda d: abs((d - reference).days))


def parse_libcal_weeks(page_html: str, reference: date) -> dict[str, tuple[str, str] | None]:
    """{iso_date: (open, close) | None for "Closed"} from the weekly tables (the first location row of each, "Today's Hours"
    = the building). A cell this cannot read is left out (unknown that day), never guessed."""
    out: dict[str, tuple[str, str] | None] = {}
    for table in re.findall(r'<table class="[^"]*s-lc-h-w[^"]*">(.*?)</table>', page_html, re.S):
        heads = re.findall(r'<span class="s-lc-h-head-date">\s*([A-Za-z]{3})\s+(\d{1,2})', table)
        row_m = re.search(r'<tr class="s-lc-h-loc[^"]*">(.*?)</tr>', table, re.S)
        if not heads or not row_m:
            continue
        cells = re.findall(r"<td(?![^>]*s-lc-h-locname)[^>]*>(.*?)</td>", row_m.group(1), re.S)
        if len(cells) != len(heads):
            continue
        for (mon, day), cell in zip(heads, cells):
            if mon.lower()[:3] not in _MONTHS:
                continue
            iso = _resolve_year(_MONTHS[mon.lower()[:3]], int(day), reference).isoformat()
            text = _text(cell)
            if text.lower() == "closed":
                out[iso] = None
                continue
            window = _parse_time_range(_normalize(text))
            if window is not None and window[0] != "sunrise":
                out[iso] = window
    return out


# --- generic "Hours" block on a CivicPlus content page (Broomfield departments) ------------------------------------------------

_HOURS_LABEL_RE = re.compile(
    r"\b(?:(?:Court |Building )?Business |Building |Office |Lobby )?Hours:?\s+((?:Monday|Mon|Tuesday|Tues?)\b.{0,140})", re.I)


def hours_block_text(page_html: str) -> str | None:
    """The page's own words after a label "Hours" ("Court Business Hours", "Building Hours:", "Hours") that is followed by a
    day name, up to 140 characters, for a person to compare; scripts and styles are removed first. None when there is none
    (the "Holiday Adjusted Hours" banner is not followed by a day, so it never counts)."""
    body = re.sub(r"<(script|style)\b.*?</\1>", " ", page_html, flags=re.S | re.I)
    m = _HOURS_LABEL_RE.search(_text(body))
    return m.group(1).strip() if m else None


# --- runs -------------------------------------------------------------------------------------------------------------------

def _hhmm(v) -> str | None:
    return None if v is None else str(v)[:5]


def run_brookings_catalog(fetcher: PoliteFetcher, conn, apply: bool, today: date) -> int:
    cur = conn.cursor()
    cur.execute("SELECT id, slug, name, hours_text, hours_structured, verification_method, source_url, "
                "(SELECT count(*) FROM place_hours ph WHERE ph.place_id = p.id) "
                "FROM places p WHERE town_id = 'brookings_sd'")
    places = cur.fetchall()
    by_key = {name_key(r[2]): r for r in places}
    listing = fetcher.get(BROOKINGS_CATALOG)
    if isinstance(listing, Refused):
        print(f"[refused] {BROOKINGS_CATALOG}: {listing.reason}")
        return 1
    urls = catalog_detail_links(listing.text)
    urls += [r[6] for r in places if r[6] and BROOKINGS_DETAIL_RE.match(r[6]) and r[6] not in urls]
    print(f"{len(urls)} detail pages reachable by GET (list page 1 + pages the rows link to); later list pages need a POST")
    changed = 0
    for url in urls:
        got = fetcher.get(url)
        if isinstance(got, Refused):
            print(f"[refused] {url}: {got.reason}")
            continue
        entry = parse_catalog_detail(got.text, url)
        if entry is None or not entry.hours_text:
            print(f"[no hours] {url}")
            continue
        row = by_key.get(name_key(entry.name))
        if row is None:
            print(f"[no place row] {entry.name!r}: {entry.hours_text!r} ({url})")
            continue
        pid, slug, _, own_text, own_struct, method, _, n_rows = row
        has_own = bool(own_text or own_struct or n_rows)
        if has_own and method != CATALOG_METHOD:
            same = (own_text or "").strip() == entry.hours_text
            print(f"[{'same' if same else 'DIFFERS, kept'}] {slug}: own {own_text!r} / catalog {entry.hours_text!r}")
            continue
        parsed = parse_hours_text(entry.hours_text)
        print(f"[{'apply' if apply else 'dry-run'}] {slug}: {entry.hours_text!r} -> "
              f"{'flagged: ' + parsed.reason if parsed.structured is None else json.dumps(parsed.structured)}")
        changed += 1
        if apply:
            _write_text_and_structure(cur, pid, entry.hours_text, parsed, url, today, CATALOG_METHOD)
    print(f"\n{changed} place(s) {'written' if apply else 'would change'}")
    return 0


def _write_text_and_structure(cur, pid: int, text: str, parsed, url: str, today: date, method: str) -> None:
    structured = parsed.structured
    rows_ok = structured is not None and "seasons" not in structured and not any(
        w and w[0] == "sunrise" for w in structured.values())
    cur.execute("UPDATE places SET hours_text = %s, hours_structured = %s, hours_needs_review = %s, source_url = %s, "
                "verified_date = %s, verification_method = %s, hours_confidence = %s WHERE id = %s",
                (text, json.dumps(structured) if structured else None, parsed.needs_review, url, today, method,
                 "structured" if rows_ok else None, pid))
    cur.execute("DELETE FROM place_hours WHERE place_id = %s", (pid,))
    if rows_ok:
        for i, day in enumerate(DAYS):
            w = structured.get(day)
            cur.execute("INSERT INTO place_hours (place_id, day_of_week, opens, closes) VALUES (%s, %s, %s, %s)",
                        (pid, i, w[0] if w else None, w[1] if w else None))


def run_briggs(fetcher: PoliteFetcher, conn, apply: bool, today: date) -> int:
    got = fetcher.get(LIBCAL_HOURS)
    if isinstance(got, Refused):
        print(f"[refused] {LIBCAL_HOURS}: {got.reason}")
        return 1
    days = {d: w for d, w in parse_libcal_weeks(got.text, today).items() if d >= today.isoformat()}
    if not days:
        print("[no dates] LibCal page had no readable week: nothing changed")
        return 1
    cur = conn.cursor()
    cur.execute("SELECT id FROM places WHERE town_id = 'brookings_sd' AND slug = %s", (BRIGGS_SLUG,))
    row = cur.fetchone()
    if not row:
        print(f"[no place row] {BRIGGS_SLUG}")
        return 1
    print(f"[{'apply' if apply else 'dry-run'}] {BRIGGS_SLUG}: {len(days)} dated days, {min(days)}..{max(days)}"
          f"{' (llm_excluded source, deterministic parse)' if got.llm_excluded else ''}")
    for d in sorted(days)[:14]:
        w = days[d]
        print(f"    {d} {'closed' if w is None else f'{w[0]}-{w[1]}'}")
    if apply:
        pid = row[0]
        cur.execute("DELETE FROM place_hours WHERE place_id = %s", (pid,))
        for d, w in sorted(days.items()):
            weekday = (date.fromisoformat(d).weekday() + 1) % 7  # 0=Sunday, place_hours' convention
            cur.execute("INSERT INTO place_hours (place_id, day_of_week, opens, closes, valid_from, valid_to) "
                        "VALUES (%s, %s, %s, %s, %s, %s)", (pid, weekday, w[0] if w else None, w[1] if w else None, d, d))
        cur.execute("UPDATE places SET hours_confidence = 'structured', verified_date = %s, verification_method = %s "
                    "WHERE id = %s", (today, LIBCAL_METHOD, pid))
    return 0


def run_broomfield_departments(fetcher: PoliteFetcher, conn) -> int:
    """Report only: the page's own "Hours" text beside the hand-entered place_hours rows."""
    cur = conn.cursor()
    for slug in BROOMFIELD_DEPARTMENTS:
        cur.execute("SELECT id, source_url FROM places WHERE town_id = 'broomfield_co' AND slug = %s", (slug,))
        row = cur.fetchone()
        if not row or not row[1]:
            print(f"[no source] {slug}")
            continue
        pid, url = row
        cur.execute("SELECT day_of_week, opens, closes FROM place_hours WHERE place_id = %s ORDER BY day_of_week, opens", (pid,))
        db_rows = [(DAYS[d][:3], _hhmm(o), _hhmm(c)) for d, o, c in cur.fetchall()]
        got = fetcher.get(url)
        if isinstance(got, Refused):
            print(f"[refused] {slug} {url}: {got.reason}")
            continue
        block = hours_block_text(got.text)
        print(f"{slug} ({url})\n    page: {block!r}\n    db:   {db_rows}")
    return 0


def main(argv: list[str]) -> int:
    import argparse
    from db.db import get_conn
    ap = argparse.ArgumentParser(prog="python -m scrapers.facility_hours")
    ap.add_argument("job", choices=("brookings-catalog", "briggs", "broomfield-departments"))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)
    today = date.today()
    town = "broomfield_co" if args.job == "broomfield-departments" else "brookings_sd"
    fetcher = PoliteFetcher("register", town)
    with get_conn() as conn:
        if args.job == "brookings-catalog":
            return run_brookings_catalog(fetcher, conn, args.apply, today)
        if args.job == "briggs":
            return run_briggs(fetcher, conn, args.apply, today)
        return run_broomfield_departments(fetcher, conn)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
