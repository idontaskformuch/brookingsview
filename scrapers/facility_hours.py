"""Opening hours read from a town's own pages (owner order D 4, 2026-11-25). Every request goes through PoliteFetcher (robots.txt
first, its Crawl-delay kept, one UA); every parse is deterministic. No page here ever reaches a language model: the Brookings site
and libcal.sdstate.edu name AI crawlers in robots.txt (llm_excluded), and nothing in this module calls one anyway.

    python -m scrapers.facility_hours brookings-catalog             # dry run: what would change
    python -m scrapers.facility_hours brookings-catalog --apply     # write (the facility-hours workflow, first Monday of a month)
    python -m scrapers.facility_hours briggs [--apply]              # Briggs Library from LibCal (the workflow, every Monday)
    python -m scrapers.facility_hours broomfield-departments        # one read per page, report only, never writes
    python -m scrapers.facility_hours reverify [--apply]            # re-read hours on file (all towns, see run_reverify)

Sources:
  * Brookings facility catalog (CivicPlus, https://www.cityofbrookings-sd.gov/Facilities): every detail page has
    <div class="section hours"><h3>Hours</h3><dl>Sunrise to 11:00p.m.</dl></div>. The list is paged by a POST
    (/Facilities/Facility/Search). Without --all-pages only what GET reaches is read: list page 1 and the detail pages the
    places rows link to. With --all-pages the list's own search form is posted (owner 2026-11-25: POST to that one address,
    polite_fetch.POST_ALLOWLIST, robots.txt first, 10 s between requests). The workflow does not pass --all-pages.
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
CATALOG_SEARCH = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Search"  # in polite_fetch.POST_ALLOWLIST
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


def catalog_search_form(list_html: str, page: int) -> dict[str, str]:
    """The form SearchSidebar.js (searchListing, not reservable-only) posts to CATALOG_SEARCH: the facility types the list page
    has checked, no features, name A-Z (sortBy 3, the page's default), 100 per page (the largest choice in its drop-down).
    null/empty fields are sent empty, as jQuery sends them."""
    ids = re.findall(r'<input type="checkbox" class="chkSidebarFacilityTypes" name="FacilityType" id="[^"]+" value="(\d+)" checked', list_html)
    return {"featureIDs": "", "categoryIDs": ",".join(ids), "occupants": "", "keywords": "", "pageSize": "100",
            "pageNumber": str(page), "sortBy": "3", "currentLatitude": "", "currentLongitude": "", "isReservableOnly": "false"}


def catalog_last_page(list_html: str) -> int:
    m = re.search(r'id="hiddenLastPageNumber" value="(\d+)"', list_html)
    return int(m.group(1)) if m else 1


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


def catalog_all_links(fetcher: PoliteFetcher, list_html: str) -> list[str] | Refused:
    """Every detail page in the catalog, through the list's own POST search (owner 2026-11-25: POST to CATALOG_SEARCH only)."""
    form = catalog_search_form(list_html, 1)
    if not form["categoryIDs"]:
        return Refused(CATALOG_SEARCH, "no checked facility types on the list page: the form would not be the page's own")
    links: list[str] = []
    page, last = 1, 1
    while page <= last:
        got = fetcher.post(CATALOG_SEARCH, catalog_search_form(list_html, page))
        if isinstance(got, Refused):
            return got
        if got.status != 200:
            return Refused(CATALOG_SEARCH, f"page {page}: HTTP {got.status}")
        links += [u for u in catalog_detail_links(got.text) if u not in links]
        last = catalog_last_page(got.text)
        page += 1
    return links


def _plain_week(structured) -> dict[str, tuple[str, str] | None] | None:
    """hours_structured (JSON lists) or a parse result (tuples) as {day: (open, close) | None} for all seven days; None for a
    season form or anything that is not one plain week."""
    if not isinstance(structured, dict) or "seasons" in structured or set(structured) != set(DAYS):
        return None
    return {d: (tuple(w) if w else None) for d, w in structured.items()}


def run_brookings_catalog(fetcher: PoliteFetcher, conn, apply: bool, today: date, all_pages: bool = False,
                          only: list[str] | None = None) -> int:
    cur = conn.cursor()
    cur.execute("SELECT id, slug, name, hours_text, hours_structured, verification_method, source_url, "
                "(SELECT count(*) FROM place_hours ph WHERE ph.place_id = p.id), name_aliases "
                "FROM places p WHERE town_id = 'brookings_sd'")
    places = cur.fetchall()
    # Close the read transaction before the fetches: --all-pages takes ~10 minutes at 10 s a page and the database ends a
    # transaction left idle that long (2026-11-25, IdleInTransactionSessionTimeout); the writes are made together at the end.
    conn.commit()
    # A row is found by its own name or by one of its name_aliases: the catalog calls city-hall "City and County Government
    # Center" and prairie-park "Brookings Prairie" (aliases set by hand, owner 2026-11-25); an alias is a name, never a guess.
    by_key = {}
    for r in places:
        for n in [r[2], *(r[8] or [])]:
            by_key.setdefault(name_key(n), r[:8])
    pending: list[tuple] = []
    confirmed: list[int] = []
    if only:
        # One or more rows' own Details pages, nothing else (owner 2026-11-25: "kör katalogen för city-hall").
        urls = [r[6] for r in places if r[1] in only and r[6] and BROOKINGS_DETAIL_RE.match(r[6])]
        missing = sorted(set(only) - {r[1] for r in places if r[6] and BROOKINGS_DETAIL_RE.match(r[6])})
        if missing:
            print(f"[no Details page] {missing}")
        return _catalog_pages(fetcher, cur, urls, by_key, pending, confirmed, apply, today)
    listing = fetcher.get(BROOKINGS_CATALOG)
    if isinstance(listing, Refused):
        print(f"[refused] {BROOKINGS_CATALOG}: {listing.reason}")
        return 1
    if all_pages:
        found = catalog_all_links(fetcher, listing.text)
        if isinstance(found, Refused):
            print(f"[refused] {found.url}: {found.reason}")
            return 1
        urls = found
        print(f"{len(urls)} detail pages in the catalog (POST search; the GET list says {catalog_last_page(listing.text)} pages of 5)")
    else:
        urls = catalog_detail_links(listing.text)
    extra = [r[6] for r in places if r[6] and BROOKINGS_DETAIL_RE.match(r[6]) and r[6].lower() not in {u.lower() for u in urls}]
    urls += extra
    if not all_pages:
        print(f"{len(urls)} detail pages reachable by GET (list page 1 + pages the rows link to); --all-pages reads the rest by POST")
    elif extra:
        print(f"    + {len(extra)} page(s) the rows link to that the search did not list: {extra}")
    return _catalog_pages(fetcher, cur, urls, by_key, pending, confirmed, apply, today)


def _catalog_pages(fetcher, cur, urls, by_key, pending, confirmed, apply: bool, today: date) -> int:
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
        if any(p[0] == pid for p in pending):
            continue  # the same place reached again under another URL (a row's own source_url)
        has_own = bool(own_text or own_struct or n_rows)
        if has_own and method != CATALOG_METHOD:
            # A hand-verified row is never rewritten. When the catalog states the same week (read with the same parser), the
            # catalog has confirmed it: verified_date = today (owner 2026-11-25); text, structure and method stay as they are.
            catalog_week = _plain_week(parse_hours_text(entry.hours_text).structured)
            same = catalog_week is not None and catalog_week == _plain_week(own_struct)
            print(f"[{'same hours, verified_date -> today' if same else 'DIFFERS, kept'}] {slug}: own {own_text!r} / catalog {entry.hours_text!r}")
            if same and pid not in confirmed:
                confirmed.append(pid)
            continue
        parsed = parse_hours_text(entry.hours_text)
        print(f"[{'apply' if apply else 'dry-run'}] {slug}: {entry.hours_text!r} -> "
              f"{'flagged: ' + parsed.reason if parsed.structured is None else json.dumps(parsed.structured)}")
        changed += 1
        pending.append((pid, entry.hours_text, parsed, url))
    if apply:
        for pid, text, parsed, url in pending:
            _write_text_and_structure(cur, pid, text, parsed, url, today, CATALOG_METHOD)
        if confirmed:
            cur.execute("UPDATE places SET verified_date = %s WHERE id = ANY(%s)", (today, confirmed))
    print(f"\n{changed} place(s) {'written' if apply else 'would change'}, {len(confirmed)} hand-verified place(s) "
          f"{'confirmed' if apply else 'would be confirmed'} (verified_date)")
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


# --- re-verification of hours already on file (owner order 2026-11-25 kväll, punkt 3) ------------------------------------------
# A place whose verification_method has a page reader here is re-read once a month (the workflow's first week, like the catalog).
# Same week on the page as in place_hours -> verified_date = today. A different week, or a page that cannot be read -> no new
# hours are written; one alert per place through scrapers/alert_state.py (key REVERIFY_SCOPE + town|slug), and the owner decides.

GLASGOW_LIFE_METHOD = "glasgow_life_page"
# scrapers/glasgow_life_events.REQUEST_DELAY_SECONDS: the same pace as the events reader, on top of PoliteFetcher's own gap.
GLASGOW_LIFE_DELAY_S = 2.0
REVERIFY_SCOPE = "hours-reverify|"
_GL_TABLE_RE = re.compile(r'<table class="table table--opening-hours">(.*?)</table>', re.S)
_GL_ROW_RE = re.compile(r'<th scope="row">\s*([A-Za-z]+)\s*</th>\s*<td>(.*?)</td>', re.S)


def parse_glasgow_life_week(page_html: str) -> dict[int, tuple[str, str] | None] | None:
    """{day_of_week (0 = Sunday): (opens, closes) | None for "Closed"} from a glasgowlife.org.uk venue page's "Opening Hours"
    table (the first one). None unless all seven days are there once each and every cell reads as one time range or "Closed"."""
    table = _GL_TABLE_RE.search(page_html)
    if not table:
        return None
    week: dict[int, tuple[str, str] | None] = {}
    for day, cell in _GL_ROW_RE.findall(table.group(1)):
        d = day.lower()
        if d not in DAYS or DAYS.index(d) in week:
            return None
        text = _text(cell)
        if text.lower() == "closed":
            week[DAYS.index(d)] = None
            continue
        window = _parse_time_range(_normalize(text))
        if window is None or window[0] == "sunrise":
            return None
        week[DAYS.index(d)] = window
    return week if len(week) == 7 else None


REVERIFIERS = {GLASGOW_LIFE_METHOD: (parse_glasgow_life_week, GLASGOW_LIFE_DELAY_S)}


def _week_line(week: dict[int, tuple[str, str] | None] | None) -> str:
    if week is None:
        return "none"
    return ", ".join(f"{DAYS[d][:3].capitalize()} {'closed' if w is None else f'{w[0]}-{w[1]}'}" for d, w in sorted(week.items()))


def _db_week(rows: list[tuple]) -> dict[int, tuple[str, str] | None] | None:
    """place_hours rows (day_of_week, opens, closes, valid_from) as one plain week, or None when they are not one (dated rows,
    two windows on a day, a missing day): such a place cannot be compared and is reported, never overwritten."""
    week: dict[int, tuple[str, str] | None] = {}
    for d, o, c, valid_from in rows:
        if valid_from is not None or d in week:
            return None
        week[d] = None if o is None else (_hhmm(o), _hhmm(c))
    return week if len(week) == 7 else None


def run_reverify(conn, apply: bool, today: date, make_fetcher=None, sleep=None, reconcile_fn=None, send=None) -> int:
    import time
    from scrapers.alert_state import reconcile
    from scrapers.alerts import send_alert
    make_fetcher = make_fetcher or (lambda town: PoliteFetcher("register", town))
    sleep = sleep or time.sleep
    reconcile_fn = reconcile_fn or reconcile
    send = send or send_alert
    cur = conn.cursor()
    cur.execute("SELECT id, town_id, slug, verification_method, source_url FROM places WHERE verification_method = ANY(%s) "
                "ORDER BY town_id, slug", (list(REVERIFIERS),))
    places = cur.fetchall()
    cur.execute("SELECT place_id, day_of_week, opens, closes, valid_from FROM place_hours WHERE place_id = ANY(%s) "
                "ORDER BY place_id, day_of_week, opens", ([p[0] for p in places],))
    rows: dict[int, list[tuple]] = {}
    for pid, d, o, c, vf in cur.fetchall():
        rows.setdefault(pid, []).append((d, o, c, vf))
    conn.commit()  # no transaction held open while the pages are read (2026-11-25, IdleInTransactionSessionTimeout)
    fetchers: dict[str, PoliteFetcher] = {}
    confirmed: list[int] = []
    active: dict[str, str] = {}
    for i, (pid, town, slug, method, url) in enumerate(places):
        parse, delay = REVERIFIERS[method]
        key = f"{REVERIFY_SCOPE}{town}|{slug}"
        ours = _db_week(rows.get(pid, []))
        if not url:
            active[key] = f"{town}/{slug}: no source_url to re-read"
            print(f"[unreadable] {town}/{slug}: no source_url")
            continue
        if i:
            sleep(delay)
        fetcher = fetchers.setdefault(town, make_fetcher(town))
        got = fetcher.get(url)
        page = None
        if isinstance(got, Refused):
            reason = got.reason
        elif got.status != 200:
            reason = f"HTTP {got.status}"
        else:
            page = parse(got.text)
            reason = "no opening-hours table that reads as one week" if page is None else ""
        if page is None:
            active[key] = f"{town}/{slug}: page could not be read ({reason}); ours {_week_line(ours)} -- {url}"
            print(f"[unreadable] {town}/{slug}: {reason}")
        elif ours != page:
            active[key] = f"{town}/{slug}: hours differ -- ours {_week_line(ours)} / page {_week_line(page)} -- {url}"
            print(f"[DIFFERS] {town}/{slug}:\n    ours {_week_line(ours)}\n    page {_week_line(page)}")
        else:
            confirmed.append(pid)
            print(f"[{'confirmed' if apply else 'dry-run: same'}] {town}/{slug}")
    print(f"\n{len(confirmed)} same, {len(active)} to report{'' if apply else ' (dry run: nothing written, no alert)'}")
    if not apply:
        return 0
    if confirmed:
        cur.execute("UPDATE places SET verified_date = %s WHERE id = ANY(%s)", (today, confirmed))
    if reconcile_fn(conn, REVERIFY_SCOPE, active, title="[facility hours] re-verification: owner's yes needed") is None and active:
        send("\n".join(active[k] for k in sorted(active)), title="[facility hours] re-verification: owner's yes needed")
    return 0


def main(argv: list[str]) -> int:
    import argparse
    from db.db import get_conn  # reads --prod from sys.argv (the write guard); argv here is a copy that still holds it
    ap = argparse.ArgumentParser(prog="python -m scrapers.facility_hours")
    ap.add_argument("job", choices=("brookings-catalog", "briggs", "broomfield-departments", "reverify"))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--all-pages", action="store_true", help="brookings-catalog: every list page via the POST search (owner 2026-11-25)")
    ap.add_argument("--only", nargs="+", metavar="SLUG", help="brookings-catalog: only these rows' own Details pages")
    args = ap.parse_args([a for a in argv if a != "--prod"])
    today = date.today()
    if args.job == "reverify":
        with get_conn() as conn:
            return run_reverify(conn, args.apply, today)
    town = "broomfield_co" if args.job == "broomfield-departments" else "brookings_sd"
    fetcher = PoliteFetcher("register", town)
    with get_conn() as conn:
        if args.job == "brookings-catalog":
            return run_brookings_catalog(fetcher, conn, args.apply, today, args.all_pages, args.only)
        if args.job == "briggs":
            return run_briggs(fetcher, conn, args.apply, today)
        return run_broomfield_departments(fetcher, conn)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
