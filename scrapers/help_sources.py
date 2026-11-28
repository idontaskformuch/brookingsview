"""/help/ step 1b (owner 2026-11-27): deterministic parsers, one per confirmed source (spec .claude/specs/help-resources.md, sources
in help-resources-phase0-report.md). No language model reads these pages: jacks-cupboard (sdstate.edu) is llm_excluded, and the rest
follow the same path so the freshness job (1c) can re-run them unchanged.

Each parser reads the page bytes (as PoliteFetcher returned them) and returns Parsed rows: a HelpEntry (db/help_places.py) plus the
schedule split the way place_hours stores it. A page whose layout no longer matches raises ParseError (1c: status `changed`).

    weekly  (day_of_week 0 = Sunday, "HH:MM", "HH:MM")      a plain week
    dates   (date, opens | None, closes | None)               dated open days, today .. today + WINDOW_DAYS (decision 3); a source
                                                              that gives days but no clock time keeps None (never a guessed time)
    closed  (date, reason)                                    -> place_hours_exceptions, from today on

parse() adds the publish / queue / reject decision (help_places.publish_decision, the town rule included) against the source
page's own text. Nothing here writes to a database.

    python -m scrapers.help_sources --dry-run            # every source from its 2026-11-27 fixture; DB read-only; prints per town
"""
from __future__ import annotations

import argparse
import calendar
import codecs
import html as _html
import re
import sys
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

from db import help_places as hp

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "help_sources_2026-11-27"
WINDOW_DAYS = 56   # decision 3: dated rows 8 weeks ahead
DAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
_ORDINALS = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5}


class ParseError(Exception):
    """The page no longer has the layout the parser was written for."""


@dataclass(frozen=True)
class Parsed:
    entry: hp.HelpEntry
    weekly: tuple = ()
    dates: tuple = ()
    closed: tuple = ()
    hours_text: str | None = None   # the schedule lines verbatim, for the card's fallback and the owner's review
    review: str | None = None       # set -> queued for the owner, never published
    role: str | None = None         # 'warm_space' on a place we may already have (decision 2)
    page_text: str = ""
    decision: str = ""
    why: str = ""


@dataclass(frozen=True)
class Source:
    id: str
    town_id: str
    url: str
    kind: str
    parser: Callable
    fixtures: dict = field(default_factory=dict)   # url -> file name in FIXTURES (the page as fetched 2026-11-27)


# --- text ------------------------------------------------------------------------------------------------------------------------
def _cp1252(err: UnicodeDecodeError):
    return err.object[err.start:err.end].decode("cp1252", errors="replace"), err.end


codecs.register_error("help_cp1252", _cp1252)


def decode(body: bytes) -> str:
    """UTF-8, with stray cp1252 bytes (moval.gov's en dashes) read as cp1252 instead of U+FFFD."""
    return body.decode("utf-8", errors="help_cp1252")


def _strip(fragment: str) -> str:
    text = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", fragment)).replace("\xa0", " ").replace("​", "")
    return re.sub(r"\s+", " ", text).strip()


def lines(html: str) -> list[str]:
    """The page's visible text, one line per block. Unlike watch_sources.page_text it keeps <header>/<footer>: an operator's
    street address is often only in the footer."""
    raw = re.sub(r"(?is)<(script|style|noscript)\b[^>]*>.*?</\1>", " ", html)
    raw = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|td|th|section|ul)>", "\n", raw)
    text = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw)).replace("\xa0", " ").replace("​", "")
    return [ln for ln in (re.sub(r"[ \t\r\f\v]+", " ", x).strip() for x in text.split("\n")) if ln]


def source_text(body: bytes) -> str:
    return "\n".join(lines(decode(body)))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold().replace("’", "").replace("'", "")).strip("-")


# --- times, days, dates ----------------------------------------------------------------------------------------------------------
_T = r"(?:noon|\d{1,2}(?:[:.]\s?\d{2})?\s*(?:[ap]\.?\s?m\b\.?)?)"
_RANGE = re.compile(rf"({_T})\s*(?:[-–—]|to)\s*({_T})", re.I)


def _clock(text: str) -> tuple[int, int, str | None]:
    t = text.strip().casefold()
    if t == "noon":
        return 12, 0, "p"
    m = re.fullmatch(r"(\d{1,2})(?:[:.]\s?(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?", t)
    if not m:
        raise ParseError(f"not a time: {text!r}")
    return int(m.group(1)), int(m.group(2) or 0), m.group(3)


def _to24(h: int, mi: int, ap: str | None) -> tuple[int, int]:
    if ap == "p":
        return h % 12 + 12, mi
    if ap == "a":
        return h % 12, mi
    return h, mi


def parse_time(text: str) -> str:
    h, mi = _to24(*_clock(text))
    return f"{h:02d}:{mi:02d}"


def parse_range(text: str) -> tuple[str, str] | None:
    """The first "opens - closes" in `text`. A start without am/pm takes the end's ("3-6 p.m." = 15:00-18:00) unless that puts it
    after the end ("11-1 pm")."""
    m = _RANGE.search(text)
    if not m:
        return None
    (h1, m1, a1), (h2, m2, a2) = _clock(m.group(1)), _clock(m.group(2))
    end = _to24(h2, m2, a2)
    start = _to24(h1, m1, a1 or a2)
    if a1 is None and a2 is not None and start > end:
        start = _to24(h1, m1, "a")
    return f"{start[0]:02d}:{start[1]:02d}", f"{end[0]:02d}:{end[1]:02d}"


def _day(token: str) -> int | None:
    t = token.casefold()[:3]
    return DAYS.index(t) if t in DAYS else None


_DAY_WORD = (r"\b(?:sun(?:days?)?|mon(?:days?)?|tue(?:s(?:days?)?)?|wed(?:nesdays?)?|thu(?:r(?:s(?:days?)?)?)?|fri(?:days?)?"
             r"|sat(?:urdays?)?)\b\.?")   # not "month"


def days_in(text: str, *, dash_is_list: bool = False) -> list[int]:
    """Days named in `text`. "Mon. - Fri." / "Monday – Wednesday" / "Sat. - Sun." are ranges (wrapping past Saturday);
    "Tuesdays and Wednesdays" / "Monday & Tuesday" are lists. dash_is_list: the page joins a list with dashes
    ("Monday - Wednesday - Friday", Brookings County Food Pantry)."""
    found = [(m.start(), m.end(), _day(m.group(0))) for m in re.finditer(_DAY_WORD, text, re.I)]
    out: list[int] = []
    i = 0
    while i < len(found):
        s, e, d = found[i]
        if (not dash_is_list and i + 1 < len(found)
                and re.fullmatch(r"\s*(?:[-–—]|to|through)\s*", text[e:found[i + 1][0]], re.I)):
            end = found[i + 1][2]
            k = d
            while True:
                out.append(k)
                if k == end:
                    break
                k = (k + 1) % 7
            i += 2
            continue
        out.append(d)
        i += 1
    return list(dict.fromkeys(out))


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date | None:
    """n-th weekday (0 = Sunday) of the month, None when the month has no such day (a 5th)."""
    py = (weekday - 1) % 7  # Python: Monday = 0
    first = date(year, month, 1)
    d = first + timedelta(days=(py - first.weekday()) % 7 + 7 * (n - 1))
    return d if d.month == month else None


def monthly_dates(rule: str, start: date, days: int = WINDOW_DAYS) -> list[date] | None:
    """Dates of a monthly pattern ("Every 2nd and 4th Saturday", "the 2nd Thursday of the month") in [start, start + days).
    None when the rule cannot be placed: "every other Monday" has no anchor on the page."""
    if re.search(r"every other", rule, re.I):
        return None
    ords = [_ORDINALS[o] for o in re.findall(r"\b(1st|2nd|3rd|4th|5th)\b", rule)]
    wd = days_in(rule)
    if not ords or len(wd) != 1:
        return None
    end = start + timedelta(days=days)
    out = []
    y, m = start.year, start.month
    while date(y, m, 1) < end:
        for n in ords:
            d = _nth_weekday(y, m, wd[0], n)
            if d and start <= d < end:
                out.append(d)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return sorted(out)


_MONTHS = {name.casefold(): i for i, name in enumerate(calendar.month_name) if name}


def resolve_date(month: int, day: int, weekday: str, today: date) -> date | None:
    """A date the page gives without a year ("Thursday, November 26th"): the year, nearest today, whose date falls on the
    weekday the page names. None when no year in today.year-1 .. today.year+1 fits (the page contradicts itself)."""
    want = _day(weekday)
    fits = []
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            continue
        if (d.weekday() + 1) % 7 == want:
            fits.append(d)
    return min(fits, key=lambda d: abs((d - today).days)) if fits else None


def _in_window(d: date, today: date) -> bool:
    return today <= d < today + timedelta(days=WINDOW_DAYS)


def _week(days: list[int], opens: str, closes: str) -> list[tuple]:
    return [(d, opens, closes) for d in days]


def _sorted_week(rows) -> tuple:
    return tuple(sorted(set(rows), key=lambda r: (r[0], r[1])))


def _find(pattern: str, text: str, what: str, flags=0) -> re.Match:
    m = re.search(pattern, text, flags)
    if not m:
        raise ParseError(f"{what} not found")
    return m


def _entry(src: Source, name: str, category: str, requirements=(), **kw) -> hp.HelpEntry:
    """The address is the street only (owner 2026-11-27). `requirements`: the source text about who can come / what to bring; the
    card shows only the labels it matches (hp.REQUIREMENT_LABELS), the matched text is kept as evidence."""
    sources = tuple(s for s in requirements if s)
    labels, evidence = hp.requirement_labels(sources)
    return hp.HelpEntry(town_id=src.town_id, slug=kw.pop("slug", None) or slugify(name), name=name, category=category,
                        source_url=src.url, source_kind=src.kind, address=kw.get("street_address"),
                        requirements_note="; ".join(labels) or None, requirements_evidence="\n".join(evidence) or None,
                        requirement_sources=sources, **kw)


def _sentence_with(pattern: str, text: str) -> str | None:
    """The sentence of `text` that matches `pattern`, verbatim; None when there is none."""
    return next((s for s in re.split(r"(?<=[.!?])\s+", text) if re.search(pattern, s, re.I)), None)


# --- Trussell Trust foodbank template (Glasgow SW, NE, NW) ------------------------------------------------------------------------
_POSTCODE = re.compile(r"^G\d{1,2}\s?\d[A-Z]{2}$")


def _trussell(src: Source, pages: dict, today: date) -> list[Parsed]:
    html = decode(pages[src.url])
    org = _strip(_find(r"<title>[^|<]*\|\s*([^<]+?)\s*</title>", html, "title").group(1))
    notice = _strip(_find(r'block--notice__description">(.*?)</div>', html, "referral notice", re.S).group(1))
    voucher = [s for s in re.split(r"(?<=\.)\s+", notice) if "voucher" in s.casefold()]
    requirement = next((s for s in voucher if re.search(r"\bneed\b", s)), voucher[0] if voucher else None)
    if requirement:
        requirement = re.sub(r"^(?:Yes|No)\s*-\s*", "", requirement).strip()
    blocks = re.split(r'<div class="\[ location\s+location--\w+ \][^"]*"', html)[1:]   # --small (SW, NE), --hero (NW)
    if not blocks:
        raise ParseError("no location blocks")
    out, seen = [], set()
    for b in blocks:
        heading = _strip(_find(r'location__heading[^>]*>(.*?)</h\d>', b, "centre heading", re.S).group(1))
        centre = re.sub(rf"\s*-\s*{re.escape(org)}$", "", heading)
        name = f"{org} – {centre}"
        if slugify(name) in seen:
            continue
        seen.add(slugify(name))
        table = _find(r"location__opening-times.*?</table>", b, f"{centre}: opening times", re.S).group(0)
        cells = re.findall(r"<td>\s*(\w{3})\s*</td>\s*<td>(.*?)</td>", table, re.S)
        if len(cells) != 7:
            raise ParseError(f"{centre}: {len(cells)} days in the opening times, not 7")
        weekly, hours = [], []
        for day, cell in cells:
            value = _strip(cell)
            hours.append(f"{day} {value}")
            if value.casefold() != "closed":
                rng = parse_range(value)
                if not rng:
                    raise ParseError(f"{centre}: {day} {value!r}")
                weekly.append((_day(day), *rng))
        addr_html = _find(r"<strong>Address</strong>\s*</p>\s*<p>(.*?)</p>", b, f"{centre}: address", re.S).group(1)
        addr = [_strip(x) for x in re.split(r"<br\s*/?>", addr_html) if _strip(x)]
        street_i = next((i for i, ln in enumerate(addr) if re.match(r"\d", ln)), None)
        post = next((ln for ln in addr if _POSTCODE.match(ln)), None)
        if street_i is None or post is None or "Glasgow" not in addr:
            raise ParseError(f"{centre}: address {addr}")
        area = [ln for ln in addr[street_i + 1:] if ln not in ("Glasgow", post)]
        phone_p = re.search(r"location__heading.*?</h\d>\s*<p>(.*?)</p>", b, re.S)
        phone = re.search(r"0\d[\d ]{8,12}\d", _strip(phone_p.group(1))) if phone_p else None
        out.append(Parsed(
            entry=_entry(src, name, "food_pantry", street_address=addr[street_i], postal_code=post,
                         location_note=", ".join(addr[:street_i]) or None,   # the building line(s) before the street
                         phone=phone.group(0) if phone else None, requirements=[requirement],
                         area_name=area[0] if len(area) == 1 else None, town_evidence=" ".join(addr[street_i:])),
            weekly=_sorted_week(weekly), hours_text="; ".join(hours)))
    return out


# --- Social Bite Glasgow (meal_program) ------------------------------------------------------------------------------------------
def _social_bite(src: Source, pages: dict, today: date) -> list[Parsed]:
    ls = lines(decode(pages[src.url]))
    try:
        t = ls.index("Takeaway free food service times")
        s = ls.index("Sit-in free food service times")
        shop = next(i for i, ln in enumerate(ls) if ln.endswith("COFFEE SHOP"))
    except (ValueError, StopIteration) as exc:
        raise ParseError(f"Social Bite layout: {exc}") from None
    weekly, text = [], []
    take = ls[t + 1:ls.index("Learn more", t)]
    days = days_in(take[0])
    if not days:
        raise ParseError(f"takeaway days {take[0]!r}")
    text.append("Takeaway free food: " + take[0])
    for ln in take[1:]:
        weekly += _week(days, *(parse_range(ln) or _bad(ln)))
        text.append(ln)
    sit = ls[s + 1:ls.index("Learn more", s)]
    text.append("Sit-in free food:")
    for label, ln in zip(sit[::2], sit[1::2]):
        text.append(f"{label} {ln}")
        if "women" in label.casefold():
            continue   # women only: in hours_text, not in the week everyone sees
        weekly += _week(days_in(ln.split(":")[0]), *(parse_range(ln) or _bad(ln)))
    street, town, post = ls[shop + 1:shop + 4]
    if town != "Glasgow" or not _POSTCODE.match(post):
        raise ParseError(f"Social Bite address {ls[shop:shop + 4]}")
    return [Parsed(entry=_entry(src, "Social Bite Sauchiehall Street", "meal_program", street_address=street, postal_code=post,
                                town_evidence=f"{street} Glasgow {post}", open_evidence=ls[t]),   # "Takeaway free food service times"
                   weekly=_sorted_week(weekly), hours_text="; ".join(text))]


def _bad(text: str):
    raise ParseError(f"no time range in {text!r}")


# --- Moreno Valley: city pantry list (official) ----------------------------------------------------------------------------------
def _moval_pantries(src: Source, pages: dict, today: date) -> list[Parsed]:
    html = decode(pages[src.url])
    serves = _strip(_find(r"(The pantries below serve residents across Moreno Valley\.)", html, "serves sentence").group(1))
    cards = html.split('<li class="ps-pantry-card">')[1:]
    if len(cards) < 10:
        raise ParseError(f"{len(cards)} pantry cards")
    out = []
    for card in cards:
        name = _strip(_find(r'ps-pantry-name">(.*?)</h3>', card, "pantry name", re.S).group(1))
        items = re.findall(r"<li>(.*?)</li>", card, re.S)
        address = next((_strip(x) for x in items if "fa-location-dot" in x), None)
        phone = next((_strip(x) for x in items if "fa-phone" in x), None)
        clock = [_strip(x) for x in items if "fa-clock" in x]
        other = [_strip(x) for x in items if "fa-" not in x]
        if not clock:
            raise ParseError(f"{name}: no schedule")
        street = postal = where = None
        evidence = serves
        if address:
            loc = re.search(r"Moreno Valley, CA(?: (\d{5}))?", address)
            if loc:
                evidence = loc.group(0)
                postal = loc.group(1)
                street = address[:loc.start()].rstrip(", ") or None
                # running text after the locality ("- Located at the ... (VFW) building.", "(call for location)")
                rest = address[loc.end():].strip(" -–").strip()
                rest = rest[1:-1] if rest.startswith("(") and rest.endswith(")") else rest
                where = rest[:1].upper() + rest[1:] if rest else None
            else:
                where = address   # a building without a street ("Moreno Valley Conference & Recreation Center")
        first = clock[0]
        requirement, review, rule, weekly, dates = None, None, None, [], []
        card_text = " ".join(clock)
        if "Summer Hours" in card_text and "School Year Hours" in card_text:
            review = "two schedules (Summer Hours, School Year Hours) and no dates for either: which one runs now is not on the page"
        else:
            rng = parse_range(first)
            if not rng:
                raise ParseError(f"{name}: {first!r}")
            m = _RANGE.search(first)
            prefix = re.sub(r"[\s,]*(?:from)?\s*$", "", first[:m.start()])
            suffix = first[m.end():].strip(" –-")
            if re.match(r"Must\b", suffix):
                requirement = re.split(r"\s*\*", suffix)[0].strip()
            if re.search(r"every other", prefix, re.I):
                review = f"{prefix!r}: no start date on the page, the weeks cannot be placed"
            elif re.search(r"\b(1st|2nd|3rd|4th|5th)\b", prefix):
                rule = re.sub(r"^Distribution takes place\s+", "", prefix)
                ds = monthly_dates(rule, today)
                if ds is None:
                    raise ParseError(f"{name}: rule {rule!r}")
                dates = [(d, *rng) for d in ds]
                rule = prefix if prefix.startswith("Every") else rule
                listed = re.search(r"dates include (.+)\.", card_text)
                if listed:   # the page's own dates must agree with the rule
                    for mon, dd in re.findall(r"([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th)", listed.group(1)):
                        d = date(today.year, _MONTHS[mon.casefold()], int(dd))
                        if _in_window(d, today) and d not in ds:
                            review = f"listed date {d} is not on the rule {rule!r}"
            else:
                days = days_in(prefix)
                if not days:
                    raise ParseError(f"{name}: days in {prefix!r}")
                weekly = _week(days, *rng)
        for x in other:
            m = re.match(r"ELIGIBILITY:\s*(.+?)\.", x)
            if m:
                requirement = m.group(1)
        out.append(Parsed(
            entry=_entry(src, name, "food_pantry", street_address=street, postal_code=postal, location_note=where,
                         phone=phone, requirements=[requirement], schedule_rule=rule, town_evidence=evidence),
            weekly=_sorted_week(weekly), dates=tuple(dates), hours_text=" / ".join(clock), review=review))
    return out


# --- Moreno Valley: warm centers (official, undated page) ------------------------------------------------------------------------
_MOVAL_WARM_STALE = ("the page has no date or season and still says masks will be required for all staff, volunteers, and visitors "
                     "(CDC era): it must be confirmed as this winter's list before a warm center is shown")


def _moval_warm(src: Source, pages: dict, today: date) -> list[Parsed]:
    html = decode(pages[src.url])
    ls = lines(html)
    flat = " ".join(ls)
    sentences = [s for ln in ls for s in re.split(r"(?<=\.)\s+", ln)]
    serves = next((s for s in sentences if re.search(r"residents may seek refuge at the City of Moreno Valley", s)), None)
    if serves is None:
        raise ParseError("serves sentence")
    stale = "masks will be required" in flat
    starts = [i for i, ln in enumerate(ls) if ln == "Location"]
    if len(starts) < 2:
        raise ParseError("no warm center blocks")
    end_all = next((i for i, ln in enumerate(ls) if ln.startswith("Precautions")), len(ls))
    out = []
    for n, i in enumerate(starts):
        name, address = ls[i - 1], ls[i + 1]
        stop = starts[n + 1] - 2 if n + 1 < len(starts) else end_all
        try:
            h = ls.index("Hours:", i, stop)
        except ValueError:
            raise ParseError(f"{name}: no Hours:") from None
        hours = [ln for ln in ls[h + 1:stop] if parse_range(ln)]
        weekly = []
        for ln in hours:
            m = _RANGE.search(ln)
            days = days_in(ln[:m.start()])
            closed = re.search(rf"closed ({_DAY_WORD})", ln, re.I)
            if not days:
                days = [d for d in range(7) if not closed or d != _day(closed.group(1))]
            weekly += _week(days, *parse_range(ln))
        senior = "Seniors 50 and older only" in ls[i - 2]
        street = re.sub(r",\s*Moreno Valley$", "", address)
        out.append(Parsed(
            entry=_entry(src, name, "warm_space", street_address=street,
                         requirements=["Seniors 50 and older only"] if senior else [],
                         audience_tags=("seniors",) if senior else (), town_evidence=serves),
            weekly=_sorted_week(weekly), hours_text="; ".join(hours), role="warm_space",
            review=_MOVAL_WARM_STALE if stale else None))
    return out


# --- Brookings ------------------------------------------------------------------------------------------------------------------
def _bcfp(src: Source, pages: dict, today: date) -> list[Parsed]:
    text = source_text(pages[src.url])
    flat = re.sub(r"\s+", " ", text)
    m = _find(rf"now located at (\d+ [A-Z][\w ]+?), is open for Public Assistance ((?:{_DAY_WORD}\s*-?\s*)+)\s*({_RANGE.pattern})",
              flat, "hours", re.I)
    street, days, span = m.group(1), days_in(m.group(2), dash_is_list=True), m.group(3)
    closed, review = [], None
    block = _find(r"closed for the following holidays in \d{4}(.*?)We apologize", flat, "holiday list").group(1)
    for wd, mon, dd, yy, why in re.findall(r"(\w+day), (\w+) (\d{1,2}), (\d{4}), (.+?)(?=\s*\w+day, \w+ \d|\s*\*|$)", block):
        d = date(int(yy), _MONTHS[mon.casefold()], int(dd))
        if (d.weekday() + 1) % 7 != _day(wd):
            review = f"{wd}, {mon} {dd}, {yy} is not a {wd}"
        if d >= today:
            closed.append((d, why.strip()))
    evidence = _find(r"EMERGENCY food needs of Brookings County families", flat, "serves phrase").group(0)
    phone = _find(r"directly: (\d{3}-\d{3}-\d{4})", flat, "phone").group(1)
    bring = [p for p in ("Proof of your physical address", "Current picture identification") if p in flat]
    return [Parsed(entry=_entry(src, "Brookings County Food Pantry", "food_pantry", street_address=street,
                                phone=phone, requirements=bring, town_evidence=evidence),
                   weekly=_sorted_week(_week(days, *parse_range(span))), closed=tuple(closed),
                   hours_text=f"{m.group(2).strip()} {span}", review=review)]


def _feeding_brookings(src: Source, pages: dict, today: date) -> list[Parsed]:
    flat = re.sub(r"\s+", " ", source_text(pages[src.url]))
    m = _find(rf"every ({_DAY_WORD}) from ({_RANGE.pattern})", flat, "hours", re.I)
    where = _find(r"Ascension Lutheran Church in Brookings\. (\d+ [\w ]+?St\.)", flat, "street")
    evidence = _find(r"Ascension Lutheran Church in Brookings, SD", flat, "locality").group(0)
    phone = re.search(r"information phone line: (\d{3} \d{3} \d{4})", flat)
    return [Parsed(entry=_entry(src, "Feeding Brookings", "food_pantry", street_address=where.group(1),
                                location_note="Ascension Lutheran Church",
                                phone=phone.group(1) if phone else None,
                                requirements=["There is no residency requirement"] if "There is no residency requirement" in flat
                                else [],
                                audience_tags=("everyone",) if "All in need are welcome" in flat else (), town_evidence=evidence),
                   weekly=_sorted_week(_week(days_in(m.group(1)), *parse_range(m.group(2)))), hours_text=m.group(0))]


def _jacks(src: Source, pages: dict, today: date) -> list[Parsed]:
    """llm_excluded page (sdstate.edu): regex only, nothing from it reaches a model."""
    ls = lines(decode(pages[src.url]))
    flat = " ".join(ls)
    m = _find(rf"((?:Fall|Spring|Summer) \d{{4}}) Hours\s*:\s*((?:{_DAY_WORD}\s*(?:and|,)?\s*)+)from ({_RANGE.pattern})", flat,
              "hours", re.I)
    where = next((ln.split(":", 1)[1].strip() for ln in ls if ln.startswith("Location:")), None)
    if not where:
        raise ParseError("Location:")
    who = _find(r"(Currently enrolled SDSU students)", flat, "eligibility").group(1)
    p = ls.index("Physical Address") if "Physical Address" in ls else None
    if p is None:
        raise ParseError("Physical Address")
    evidence = " ".join(ls[p + 2:p + 5])
    return [Parsed(entry=_entry(src, "Jack’s Cupboard", "food_pantry", slug="jacks-cupboard", location_note=where,
                                requirements=[who], audience_tags=("students",), town_evidence=evidence),
                   weekly=_sorted_week(_week(days_in(m.group(2)), *parse_range(m.group(3)))),
                   hours_text=f"{m.group(1)} Hours: {m.group(2).strip()} from {m.group(3)}")]


_HARVEST_SCHEDULE = "https://sites.google.com/view/brookingsharvesttable/serving-schedule"


def _harvest_table(src: Source, pages: dict, today: date) -> list[Parsed]:
    ls = lines(decode(pages[_HARVEST_SCHEDULE]))
    year, dates, closed = None, [], []
    for ln in ls[ls.index("Serving Schedule", ls.index("Serving Schedule") + 1):]:
        if re.fullmatch(r"20\d\d", ln):
            year = int(ln)
            continue
        m = re.fullmatch(r"([A-Z][a-z]+) (\d{1,2})--\s*(.*)", ln)
        if not m or year is None:
            continue
        d = date(year, _MONTHS[m.group(1).casefold()], int(m.group(2)))
        host = m.group(3).strip()
        if not _in_window(d, today) or not host:
            continue   # an empty host line says nothing about whether a meal is served
        if "No Meal Served" in host:
            closed.append((d, "No Meal Served"))
        else:
            dates.append((d, None, None))
    if year is None:
        raise ParseError("no schedule years")
    # Town rule: neither page gives Brookings as the meal's locality or says the meal serves Brookings ("organizations around the
    # Brookings Community to serve" is about who hosts). No town_evidence -> rejected until a page of the operator says it.
    # The home page does say the meal is free ("To provide to anyone in the community a no cost meal, ..."): the town rule alone rejects.
    home = next((ln for ln in source_text(pages[src.url]).split("\n") if hp.OPEN_TO_ALL.search(ln)), None)
    return [Parsed(entry=_entry(src, "Harvest Table", "meal_program", open_evidence=home), dates=tuple(dates), closed=tuple(closed),
                   hours_text="Mondays per the Serving Schedule; no time or address on the page")]


# --- Broomfield -----------------------------------------------------------------------------------------------------------------
def _fish(src: Source, pages: dict, today: date) -> list[Parsed]:
    ls = lines(decode(pages[src.url]))
    try:
        a = next(i for i, ln in enumerate(ls) if ln.startswith("The Broomfield FISH marketplace is open"))
        c = ls.index("Upcoming Marketplace Closures:", a)
        g = ls.index("GET IN TOUCH")
    except (StopIteration, ValueError) as exc:
        raise ParseError(f"FISH layout: {exc}") from None
    weekly, hours = [], []
    for ln in ls[a + 1:c]:
        hours.append(ln)
        if "CLOSED" in ln.upper():
            continue
        weekly += _week(days_in(ln.split(":")[0]), *(parse_range(ln) or _bad(ln)))
    closed, review = [], None
    for ln in ls[c + 1:]:
        m = re.fullmatch(r"(\w+day), (\w+) (\d{1,2})(?:st|nd|rd|th)? \((.+)\)", ln)
        if not m:
            break
        d = resolve_date(_MONTHS[m.group(2).casefold()], int(m.group(3)), m.group(1), today)
        if d is None:
            review = f"closure {ln!r}: no year puts that date on a {m.group(1)}"
        elif d >= today:
            closed.append((d, m.group(4)))
    if ls[g + 1] != "Broomfield FISH" or not re.fullmatch(r"Broomfield, CO \d{5}", ls[g + 3]):
        raise ParseError(f"FISH address {ls[g:g + 4]}")
    street, locality = ls[g + 2], ls[g + 3]
    phone = re.fullmatch(r"\d{3}-\d{3}-\d{4}", ls[g + 5])
    return [Parsed(entry=_entry(src, "Broomfield FISH", "food_pantry", street_address=street, postal_code=locality[-5:], phone=phone.group(0) if phone else None,
                                town_evidence=f"{street} {locality}"),
                   weekly=_sorted_week(weekly), closed=tuple(closed), hours_text="; ".join(hours), review=review)]


def _north_denver_cares(src: Source, pages: dict, today: date) -> list[Parsed]:
    html = decode(pages[src.url])
    sect = _find(r"Please Bring:(.*?)<p[^>]*>\*(.*?)</p>", html, "hours table", re.S)
    cells = [_strip(x) for x in re.findall(r"<h4[^>]*>(.*?)</h4>", sect.group(1), re.S)]
    if len(cells) % 3 or not cells:
        raise ParseError(f"hours table has {len(cells)} cells")
    weekly, hours, bring = [], [], []
    for when, need, _zips in zip(cells[::3], cells[1::3], cells[2::3]):
        hours.append(when)
        weekly += _week(days_in(when.split(":")[0]), *(parse_range(when) or _bad(when)))
        bring.append(need)
    flat = re.sub(r"\s+", " ", source_text(pages[src.url]))
    addr = _find(r"(\d+ W\. \d+\w* Ave, #\w+) (Broomfield, CO (\d{5}))", flat, "address")
    phone = re.search(r"contact us at (\d{3}-\d{3}-\d{4})", flat)
    return [Parsed(entry=_entry(src, "North Denver Cares", "food_pantry", street_address=addr.group(1), postal_code=addr.group(3),
                                phone=phone.group(1) if phone else None, requirements=bring,
                                town_evidence=addr.group(0)),
                   weekly=_sorted_week(weekly), hours_text="; ".join(hours) + " (*" + _strip(sect.group(2)) + ")")]


def _cross_of_christ(src: Source, pages: dict, today: date) -> list[Parsed]:
    flat = re.sub(r"\s+", " ", source_text(pages[src.url]))
    m = _find(r"Community Meals\s*[–-]\s*(On the (?:\d(?:st|nd|rd|th)(?: and )?)+ \w+ of the month)", flat, "meal rule")
    rule = m.group(1)
    ds = monthly_dates(rule, today)
    if ds is None:
        raise ParseError(f"rule {rule!r}")
    addr = _find(r"(\d+ [A-Z][A-Za-z ]+?) (Broomfield, CO (\d{5}))", flat, "address")
    # The meal's own paragraph must say it is free or open to all (hp.OPEN_TO_ALL); none -> the row is rejected, not guessed.
    para = next((ln for ln in source_text(pages[src.url]).split("\n") if ln.startswith("Community Meals")), None)
    if para is None:
        raise ParseError("meal paragraph")
    welcome = _sentence_with(r"\ball are welcome\b|\bfree\b|\bno (?:cost|charge)\b", para)
    return [Parsed(entry=_entry(src, "Cross of Christ Community Meals", "meal_program", street_address=addr.group(1),
                                location_note="Cross of Christ Lutheran Church",
                                postal_code=addr.group(3), schedule_rule=rule, open_evidence=welcome,
                                audience_tags=("everyone",) if welcome else (), town_evidence=addr.group(0)),
                   dates=tuple((d, None, None) for d in ds), hours_text=rule)]


# --- registry -------------------------------------------------------------------------------------------------------------------
def _src(id_, town, url, kind, parser, fixture, **more):
    return Source(id_, town, url, kind, parser, {url: fixture, **more})


SOURCES = (
    _src("glasgow-sw-foodbank", "glasgow", "https://glasgowsw.foodbank.org.uk/locations/", "operator", _trussell,
         "glasgowsw_locations.html"),
    _src("glasgow-ne-foodbank", "glasgow", "https://glasgowne.foodbank.org.uk/locations/", "operator", _trussell,
         "glasgowne_locations.html"),
    _src("glasgow-nw-foodbank", "glasgow", "https://glasgownw.foodbank.org.uk/locations/", "operator", _trussell,
         "glasgownw_locations.html"),
    _src("social-bite-glasgow", "glasgow", "https://www.social-bite.co.uk/coffee-shops/glasgow/", "operator", _social_bite,
         "social_bite_glasgow.html"),
    _src("moval-food-pantries", "moreno_valley_ca", "https://moval.gov/mymoval/food-pantries.html", "official", _moval_pantries,
         "moval_food_pantries.html"),
    _src("moval-warm", "moreno_valley_ca", "https://moval.org/warm/", "official", _moval_warm, "moval_warm.html"),
    _src("brookings-county-food-pantry", "brookings_sd", "https://brookingscountyfoodpantry.weebly.com/", "operator", _bcfp,
         "brookings_county_food_pantry.html"),
    _src("feeding-brookings", "brookings_sd", "https://www.feedingbrookings.org/", "operator", _feeding_brookings,
         "feedingbrookings.html"),
    _src("jacks-cupboard", "brookings_sd",
         "https://www.sdstate.edu/student-life/division-student-affairs-enrollment-management/jacks-cupboard", "operator", _jacks,
         "jacks_cupboard.html"),
    _src("harvest-table", "brookings_sd", "https://sites.google.com/view/brookingsharvesttable/home", "operator", _harvest_table,
         "harvesttable_home.html", **{_HARVEST_SCHEDULE: "harvesttable_schedule.html"}),
    _src("broomfield-fish", "broomfield_co", "https://www.broomfieldfish.org/", "operator", _fish, "broomfieldfish.html"),
    _src("north-denver-cares", "broomfield_co", "https://crossroadsabc.com/north-denver-cares/", "operator", _north_denver_cares,
         "north_denver_cares.html"),
    _src("cross-of-christ-meals", "broomfield_co", "https://cross-of-christ.org/serve/outreach-support/", "operator",
         _cross_of_christ, "cross_of_christ_outreach.html"),
)
SOURCE_BY_ID = {s.id: s for s in SOURCES}


def parse(src: Source, pages: dict, today: date) -> list[Parsed]:
    """The source's rows with their decision. The page text every check runs against is all of the source's pages together."""
    text = "\n".join(source_text(pages[u]) for u in src.fixtures if u in pages)
    out = []
    for row in src.parser(src, pages, today):
        decision, why = hp.publish_decision(row.entry, text, row.review)
        out.append(replace(row, page_text=text, decision=decision, why=why))
    return out


# --- dry run --------------------------------------------------------------------------------------------------------------------
_DOW = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")


_MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _hm(hhmm: str) -> tuple[int, int, bool]:
    h, m = (int(x) for x in hhmm[:5].split(":"))
    return h % 12 or 12, m, h >= 12


def _num(h: int, m: int) -> str:
    return f"{h}:{m:02d}" if m else str(h)


def clock_range(opens: str, closes: str, country: str) -> str:
    """The sites' own formats (owner 2026-11-27). us = timesCompact in site/src/lib/answer-facility.ts ("1–4:30 PM", "8 AM–5 PM",
    noon/midnight by name, "24 hours"); gb = the facility pages' formatClock(gb) on both ends ("12pm–2pm", "8:30am–9:30am")."""
    a, b = _hm(opens), _hm(closes)
    if country == "gb":
        return "–".join(f"{_num(h, m)}{'pm' if pm else 'am'}" for h, m, pm in (a, b))
    if opens[:5] == "00:00" and closes[:5] in ("23:59", "24:00", "00:00"):
        return "24 hours"
    named = lambda c: ("noon" if c[2] else "midnight") if c[0] == 12 and c[1] == 0 else None   # noqa: E731
    one = lambda c: named(c) or f"{_num(c[0], c[1])} {'PM' if c[2] else 'AM'}"   # noqa: E731
    past_midnight = closes[:5] <= opens[:5]
    if not named(a) and not named(b) and a[2] == b[2] and not past_midnight:
        return f"{_num(a[0], a[1])}–{_num(b[0], b[1])} {'PM' if b[2] else 'AM'}"
    return f"{one(a)}–{one(b)}"


def _days(days: list[int]) -> str:
    """daysCompact (answer-facility.ts): Monday first, a run of days as a range ("Mon–Fri"), "daily" for all seven."""
    order = sorted(set(days), key=lambda d: (d - 1) % 7)
    if len(order) == 7:
        return "daily"
    runs: list[list[int]] = []
    for d in order:
        if runs and (d - 1) % 7 == (runs[-1][-1] - 1) % 7 + 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    return ", ".join(f"{_DOW[r[0]]}–{_DOW[r[-1]]}" if len(r) > 1 else _DOW[r[0]] for r in runs)


def week_line(weekly, country: str) -> str:
    """Rows grouped by identical times in the order they first appear Monday-first, as the facility meta does (groupHours):
    "Mon, Wed, Fri 1–4:30 PM; Sat 9 AM–noon"."""
    groups: dict = {}
    for d, o, c in sorted(weekly, key=lambda r: ((r[0] - 1) % 7, r[1])):
        groups.setdefault((o, c), []).append(d)
    return "; ".join(f"{_days(ds)} {clock_range(o, c, country)}" for (o, c), ds in groups.items())


def short_date(d: date, country: str) -> str:
    """shortDate (answer-facility.ts): "Tue Dec 1" (us), "Tue 1 Dec" (gb)."""
    mon = _MON[d.month - 1]
    return f"{_DOW[(d.weekday() + 1) % 7]} {d.day} {mon}" if country == "gb" else f"{_DOW[(d.weekday() + 1) % 7]} {mon} {d.day}"


def card(row: Parsed, today: date) -> str:
    """The card as /help/ would show it (step 1d builds it in the site with the same rules; this is the content): name, area (area
    name + postal code), street address, location note, times in the site's format, requirement labels, source."""
    e = row.entry
    country = "gb" if e.town_id == "glasgow" else "us"
    if row.weekly:
        when = week_line(row.weekly, country)
    elif row.dates:
        upcoming = [r for r in row.dates if r[0] >= today]
        shown = [short_date(d, country) + (f" {clock_range(o, c, country)}" if o and c else "") for d, o, c in upcoming[:4]]
        when = ", ".join(shown) + (" …" if len(upcoming) > 4 else "")
    else:
        when = ""
    closed = hp.upcoming_closures(row.closed, today)
    out = [f"  {e.name}"]
    area = " ".join(x for x in (e.area_name, e.postal_code) if x)
    for label, value in (("Area", area), ("Address", e.street_address), ("Where", e.location_note), ("When", when),
                         ("Closed", ", ".join(short_date(d, country) for d, _ in closed)), ("Needs", e.requirements_note),
                         ("For", ", ".join(e.audience_tags))):
        if value:
            out.append(f"    {label + ':':<9} {value}")
    out.append(f"    Source:   {e.source_url}  (Checked <date of write>)")
    return "\n".join(out)


def _existing(town_id: str) -> tuple[set, list]:
    """Read-only: slugs in the town (a help slug must not collide with a venue) and (name, category, address) for warm roles."""
    try:
        from db.db import connect
        conn = connect()
    except Exception as exc:   # no DB: the dry run still shows the parse
        print(f"  (no DB read: {exc.__class__.__name__})")
        return set(), []
    with conn, conn.cursor() as cur:
        cur.execute("SELECT slug, name, category, coalesce(address, '') FROM places WHERE town_id = %s", (town_id,))
        rows = cur.fetchall()
    conn.close()
    return {r[0] for r in rows}, rows


def dry_run(today: date) -> int:
    towns: dict = {}
    for src in SOURCES:
        pages = {u: (FIXTURES / n).read_bytes() for u, n in src.fixtures.items()}
        try:
            rows = parse(src, pages, today)
        except ParseError as exc:
            towns.setdefault(src.town_id, []).append((src, None, str(exc)))
            continue
        for r in rows:
            towns.setdefault(src.town_id, []).append((src, r, None))
    for town in ("brookings_sd", "broomfield_co", "moreno_valley_ca", "glasgow"):
        items = towns.get(town, [])
        slugs, places = _existing(town)
        counts = {k: sum(1 for _, r, _ in items if r and r.decision == k) for k in ("publish", "queue", "reject")}
        print(f"\n=== {town}: publish {counts['publish']}, queue {counts['queue']}, reject {counts['reject']}"
              f" -> /help/ {'shown' if hp.page_has_enough(counts['publish']) else f'hidden (under {hp.MIN_ENTRIES})'}")
        for src, r, err in items:
            if r is None:
                print(f"  PARSE ERROR {src.id}: {err}")
                continue
            note = f"  [{hp.town_kind(town, r.entry.town_evidence) or 'no town'}]"
            clash = "  SLUG IN USE" if r.entry.slug in slugs else ""
            role = ""
            if r.role and r.entry.street_address:
                num = r.entry.street_address.split()[0]
                hit = [f"{n} ({c})" for _, n, c, a in places if num in a]
                role = f"  role on: {hit[0]}" if hit else "  role: no existing place (new warm_space row)"
            print(f"  {r.decision.upper():7} {r.entry.name}{note}{clash}{role}" + (f"\n           why: {r.why}" if r.why else ""))
            unlabelled = [s for s in r.entry.requirement_sources if not hp.requirement_labels([s])[0]]
            if unlabelled:   # requirement text that matches no label: no line on the card; shown here for the owner
                print(f"           no label: {unlabelled}")
        published = [(s, r) for s, r, _ in items if r and r.decision == "publish"]
        firsts = list({s.id: r for s, r in reversed(published)}.values())[::-1]   # one per source first
        shown = (firsts + [r for _, r in published if r not in firsts])[:3]
        if shown:
            print("  -- example cards --")
            for r in shown:
                print(card(r, today))
    return 0


def parse_all(today: date) -> list[tuple[Source, Parsed]]:
    """Every source from its fixture (the pages fetched 2026-11-27), as the dry run reads them. A ParseError stops everything."""
    out = []
    for src in SOURCES:
        pages = {u: (FIXTURES / n).read_bytes() for u, n in src.fixtures.items()}
        out += [(src, r) for r in parse(src, pages, today)]
    return out


def role_target(row: Parsed, places) -> tuple:
    """The one existing non-help place a role row belongs on: same street number in its address (the dry run's match).
    places = (id, slug, name, category, address). Zero or several hits raise: never a guess."""
    num = (row.entry.street_address or "").split()[0] if row.entry.street_address else ""
    hits = [p for p in places if num and p[3] not in hp.HELP_CATEGORIES and re.search(rf"(?<!\d){re.escape(num)}(?!\d)", p[4] or "")]
    if len(hits) != 1:
        raise ValueError(f"role {row.entry.name}: {len(hits)} places match street number {num!r}: {[h[1] for h in hits]}")
    return hits[0]


def write(cur, today: date) -> dict:
    """Step 1c (owner 2026-11-27): the dry run's rows into places / place_hours / place_hours_exceptions / place_roles.
    publish -> verified; queue -> 'queued' (stored, hidden); reject -> nothing. Returns per town counts + lines for the report."""
    report: dict = {}
    places_by_town: dict = {}
    for src, row in parse_all(today):
        e = row.entry
        t = report.setdefault(e.town_id, {"publish": 0, "queue": 0, "reject": 0, "lines": []})
        t[row.decision] += 1
        if row.decision == "reject":
            t["lines"].append(f"REJECT {e.name}: {row.why}")
            continue
        status = "verified" if row.decision == "publish" else "queued"
        if row.role:
            if e.town_id not in places_by_town:
                cur.execute("SELECT id, slug, name, category, coalesce(address, '') FROM places WHERE town_id = %s", (e.town_id,))
                places_by_town[e.town_id] = cur.fetchall()
            pid, slug, name, *_ = role_target(row, places_by_town[e.town_id])
            hp.write_role(cur, pid, row.role, e, today, status=status, schedule_text=row.hours_text)
            t["lines"].append(f"{status.upper()} role {row.role} on {slug} (id {pid}) <- {e.name}" + (f"  why: {row.why}" if row.why else ""))
            continue
        action = hp.write_entry(cur, e, today, status=status)
        cur.execute("SELECT id FROM places WHERE town_id = %s AND slug = %s", (e.town_id, e.slug))
        pid = cur.fetchone()[0]
        n_hours, n_exc = hp.write_schedule(cur, pid, row.weekly, row.dates, row.closed, e.source_url, today)
        t["lines"].append(f"{status.upper()} {action} {e.slug} (id {pid}) hours {n_hours} exceptions {n_exc}"
                          + (f"  why: {row.why}" if row.why else ""))
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--write", action="store_true", help="1c: write to the DB (live needs --prod + ALLOW_PROD_WRITE=help_sources)")
    ap.add_argument("--today", type=date.fromisoformat, default=date.today())
    from db.db import connect   # reads --prod from sys.argv (the write guard); argv here is a copy that still holds it
    args = ap.parse_args([a for a in argv if a != "--prod"])
    if args.dry_run:
        return dry_run(args.today)
    conn = connect()
    try:
        with conn.cursor() as cur:
            report = write(cur, args.today)
            from scrapers import help_geocode   # lat/lon for the new rows (owner 2026-11-28); fills only NULL coordinates
            geo = help_geocode.fill(cur, help_geocode._fetcher_for)
            print(f"coordinates: {len(geo.found)} found, {len(geo.missed)} left empty")
        conn.commit()
    finally:
        conn.close()
    for town, t in report.items():
        print(f"=== {town}: publish {t['publish']}, queue {t['queue']}, reject {t['reject']}")
        for line in t["lines"]:
            print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
