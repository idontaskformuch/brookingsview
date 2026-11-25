"""Deterministic parser: places.hours_text (renamed from facilities in
db/migrations/045_facilities_to_places.sql; free text, hand-curated by a
human against each facility's own official page -- see
scripts/seed_facilities.py) -> structured per-weekday open/close times.

Recurring-traffic layer handoff, Phase 2 ("Facility hours... the single
highest-confidence item in the spec"). Same philosophy as
ai_pipeline/venue_registry.py's normalize_venue() and
ai_pipeline/town_guard.py's blocklist matching: cheap, deterministic,
auditable regex/keyword parsing, never an AI judgment call about its own
output -- and the SAME "flag ambiguous rather than guess" discipline
guardrails.py's own module docstring states as this codebase's general
philosophy. A row this parser can't confidently read stays exactly as it
was (hours_text still renders as free text) and gets flagged for a human,
never silently dropped or guessed at.

Real test data (see tests/test_facility_hours.py) is the actual hours_text
values seeded for all three towns' real facilities as of 2026-09-04, not
synthetic strings invented to make the parser look good -- 10 of 12 parse
cleanly, 2 are genuinely ambiguous ("10am onward" has no close time; a
parenthetical caveat about some counters keeping separate hours) and are
correctly flagged rather than guessed at.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

_DAY_ABBR = {
    "mon": "monday", "tue": "tuesday", "wed": "wednesday", "thu": "thursday",
    "fri": "friday", "sat": "saturday", "sun": "sunday",
}
_DAY_TOKEN_RE = "|".join(_DAY_ABBR)

# En dash (U+2013) and em dash (U+2014) serve as range separators in hand-curated text; normalized to "-" up front.
_DASH_RE = re.compile("[–—]")
# "10 a.m." / "11:00p.m." -> "10am" / "11:00pm" (Brookings museum rows, Brookings facility catalog).
_MERIDIEM_DOTS_RE = re.compile(r"\b([ap])\.\s?m\.?", re.IGNORECASE)
_SPACE_BEFORE_MERIDIEM_RE = re.compile(r"(\d)\s+(am|pm)\b", re.IGNORECASE)
# "7:30am to 4pm", "Sunrise to 11pm": "to" between two times is a range separator.
_TO_RANGE_RE = re.compile(r"(\d(?::\d{2})?(?:am|pm)?|noon|midnight|sunrise)\s+to\s+(?=\d|noon|midnight)", re.IGNORECASE)

_PAREN_RE = re.compile(r"\([^)]*\)")

_TIME_RE = re.compile(r"(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(noon)|(midnight)|(sunrise))", re.IGNORECASE)

_CLOSED_DAY_RE = re.compile(rf"^closed\s+({_DAY_TOKEN_RE})\w*$", re.IGNORECASE)
_DAILY_RE = re.compile(r"^daily$", re.IGNORECASE)

# Whole-week phrase (Broomfield recycling center hours_text, 2026-11-11).
_ROUND_THE_CLOCK_RE = re.compile(r"^open 24 hours a day,? 7 days a week$", re.IGNORECASE)
# A sentence about when staff answer the phone is contact information, not opening hours (same row).
_STAFF_CONTACT_RE = re.compile(r"^staff can be reached\b", re.IGNORECASE)

_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
           "november", "december"]
# Feb has 29: an interval ending in February covers a leap day too; one that starts the day after Feb 28 starts Mar 1.
_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
_MONTH_RE = "|".join(_MONTHS)
# "mid-August" is read as the 15th (the season ends Aug 15, the next starts Aug 16): stated here as a rule so the boundary is
# the same for every row, not a guess per row (Larson Nature Center: "June-mid-August" / "mid-August to May").
_MONTH_SPEC_RE = rf"(mid-)?({_MONTH_RE})"
_RANGE_SEP_RE = r"\s*(?:-|to|through)\s*"
# "Closed Sundays January-March[ and on all state holidays]" (SD Art Museum, SD Agricultural Heritage Museum).
_CLOSED_DAYS_IN_MONTHS_RE = re.compile(
    rf"^closed\s+(\w+)\s+{_MONTH_SPEC_RE}{_RANGE_SEP_RE}{_MONTH_SPEC_RE}"
    r"(\s+and\s+on\s+all\s+(?:state\s+)?holidays)?$", re.IGNORECASE)
# "Summer (June-mid-August): <week>" followed by "Rest of year: <week>" (Larson Nature Center).
_LABELLED_SEASON_RE = re.compile(
    rf"^([A-Za-z][A-Za-z /]*?)\s*\(\s*{_MONTH_SPEC_RE}{_RANGE_SEP_RE}{_MONTH_SPEC_RE}\s*\)\s*:\s*(.+)$", re.IGNORECASE)
_REST_OF_YEAR_RE = re.compile(r"^rest of (?:the )?year\s*:\s*(.+)$", re.IGNORECASE)
# A season named without dates ("Summer: ...; Fall/Winter: ...", McCrory Gardens) cannot be placed on the calendar.
_UNDATED_SEASON_RE = re.compile(r"(?:^|[;.]\s*)(?:summer|winter|fall|autumn|spring)(?:/\w+)?\s*:", re.IGNORECASE)
# A holiday closure is a fact the week cannot hold. It is accepted (the page shows hours_text beside the table), never dropped
# from the text.
_HOLIDAY_SENTENCE_RE = re.compile(r"^(?:the\s+\w+\s+is\s+)?closed\s+on\s+all\s+(?:state\s+)?holidays\b", re.IGNORECASE)


@dataclass
class ParsedHours:
    # Either a plain week {day: (open_HHMM, close_HHMM) | None, ...} (all 7 keys), or, when the text gives hours per part of
    # the year, {"seasons": [{"from": "MM-DD", "to": "MM-DD", "label": str, "week": {...}}, ...]} whose intervals cover the
    # whole year (one may run over New Year: from "08-16" to "05-31"). None overall means parsing failed; see
    # `needs_review`/`reason`. "sunrise" may stand in place of an opening time (computed per day: site/src/lib/sun.ts).
    structured: dict | None
    needs_review: bool
    reason: str | None = None


class _Unparseable(Exception):
    pass


def _normalize(raw: str) -> str:
    text = _DASH_RE.sub("-", raw.strip())
    # "5 p.m. Closed Sundays ...": the last period of "p.m." also ends the sentence, so it stays as one.
    text = _MERIDIEM_DOTS_RE.sub(lambda m: m.group(1).lower() + "m" + ("." if m.group(0).endswith(".") and
                                 re.match(r"\s+[A-Z]|\s*$", text[m.end():]) else ""), text)
    text = _SPACE_BEFORE_MERIDIEM_RE.sub(r"\1\2", text)
    text = _TO_RANGE_RE.sub(r"\1-", text)
    return re.sub(r"\s+", " ", text)


def _parse_time(text: str, default_period: str | None = None) -> str | None:
    """"9am" -> "09:00", "6:30pm" -> "18:30", "noon" -> "12:00", "sunrise" -> "sunrise". A bare hour ("1" in "1-5pm") takes
    `default_period`. None if `text` isn't a recognized time token at all (caller treats that as a parse failure, not a guess)."""
    m = _TIME_RE.fullmatch(text.strip())
    if not m:
        return None
    if m.group(4):
        return "12:00"
    if m.group(5):
        return "00:00"
    if m.group(6):
        return "sunrise"
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    period = (m.group(3) or default_period or "").lower()
    if not period or not (1 <= hour <= 12) or minute > 59:
        return None
    if period == "am":
        hour = 0 if hour == 12 else hour
    else:
        hour = 12 if hour == 12 else hour + 12
    return f"{hour:02d}:{minute:02d}"


def _period(text: str) -> str | None:
    t = text.strip().lower()
    if t == "noon":
        return "pm"
    m = re.search(r"(am|pm)$", t)
    return m.group(1) if m else None


def _parse_time_range(text: str) -> tuple[str, str] | None:
    parts = re.split(r"\s*-\s*", text.strip(), maxsplit=1)
    if len(parts) != 2:
        return None
    close_t = _parse_time(parts[1])
    if close_t is None or close_t == "sunrise":
        return None
    open_t = _parse_time(parts[0])
    if open_t is None and re.fullmatch(r"\d{1,2}(?::\d{2})?", parts[0].strip()):
        # "1-5pm": the opening hour shares the closing time's am/pm, unless that would put it after the close ("10-5pm" = 10am).
        same = _parse_time(parts[0], _period(parts[1]))
        open_t = same if same is not None and same < close_t else _parse_time(parts[0], "am")
    if open_t is None:
        return None
    return open_t, close_t


def _day_name(token: str) -> str | None:
    """"Mon", "Tues", "Thurs", "Sundays", "Wednesday" -> the full day; anything else (e.g. "sunrise") -> None."""
    t = token.strip().lower().rstrip(".")
    for cand in (t, t[:-1] if t.endswith("s") else t):
        if len(cand) >= 3:
            for day in DAY_ORDER:
                if day.startswith(cand):
                    return day
    return None


def _expand_day_range(token: str) -> list[str] | None:
    parts = re.split(r"\s*-\s*", token.strip())
    if len(parts) == 1:
        day = _day_name(parts[0])
        return [day] if day else None
    if len(parts) != 2:
        return None
    start, end = _day_name(parts[0]), _day_name(parts[1])
    if start is None or end is None:
        return None
    if (start, end) == ("sunday", "saturday"):
        return list(DAY_ORDER)  # "Sun-Sat": the whole week, written Sunday-first
    i, j = DAY_ORDER.index(start), DAY_ORDER.index(end)
    if j < i:
        return None  # a real range never wraps Sun->Mon in this dataset -- treat as unparseable rather than guess the intent
    return DAY_ORDER[i:j + 1]


def _parse_week(text: str, raw: str) -> dict:
    """One week of hours: groups separated by "," or ";". Raises _Unparseable for anything not confidently readable."""
    days: dict = {d: None for d in DAY_ORDER}
    covered: set[str] = set()
    for raw_group in re.split(r"[,;]", text):
        group = raw_group.strip().rstrip(".").strip()
        if group.lower().endswith(" only"):
            group = group[:-5].strip()
        if not group:
            continue
        m = _CLOSED_DAY_RE.match(group)
        if m:
            day = _DAY_ABBR[m.group(1).lower()]
            days[day] = None
            covered.add(day)
            continue
        tokens = group.split(None, 1)
        if len(tokens) == 2 and tokens[0].lower() == "open":
            tokens = tokens[1].split(None, 1)  # "Open daily 11am-10pm" (Farm House Collective)
            if not tokens or not _DAILY_RE.match(tokens[0]):
                raise _Unparseable(f"opening time without days: {group!r} (from {raw!r})")
        if len(tokens) != 2:
            raise _Unparseable(f"unrecognized fragment: {group!r} (from {raw!r})")
        day_token, time_token = tokens
        if _DAILY_RE.match(day_token):
            day_list = list(DAY_ORDER)
        else:
            day_list = _expand_day_range(day_token)
            if day_list is None:
                raise _Unparseable(f"unrecognized day spec: {day_token!r} (from {raw!r})")
        time_range = _parse_time_range(time_token)
        if time_range is None:
            raise _Unparseable(f"unrecognized or open-ended time range: {time_token!r} (from {raw!r})")
        for day in day_list:
            days[day] = time_range
            covered.add(day)
    if not covered:
        raise _Unparseable(f"no day/time groups recognized: {raw!r}")
    # Days never mentioned at all default to closed -- the standard, near-universal convention for posted hours (an office
    # listing Mon-Fri hours and saying nothing about the weekend means closed weekends, not "unknown"). This is an
    # interpretation of a real-world convention, not a guess about a VALUE.
    return days


def _month_start(mid: str | None, month: str) -> tuple[int, int]:
    return (_MONTHS.index(month.lower()) + 1, 16 if mid else 1)


def _month_end(mid: str | None, month: str) -> tuple[int, int]:
    mi = _MONTHS.index(month.lower())
    return (mi + 1, 15 if mid else _MONTH_DAYS[mi])


def _mmdd(md: tuple[int, int]) -> str:
    return f"{md[0]:02d}-{md[1]:02d}"


def _day_after(md: tuple[int, int]) -> tuple[int, int]:
    m, d = md
    last = 28 if m == 2 else _MONTH_DAYS[m - 1]  # the day after Feb 28 is read as Mar 1 (a Feb 29 belongs to both)
    if d < last:
        return (m, d + 1)
    return (1 if m == 12 else m + 1, 1)


def _day_before(md: tuple[int, int]) -> tuple[int, int]:
    m, d = md
    if d > 1:
        return (m, d - 1)
    pm = 12 if m == 1 else m - 1
    return (pm, _MONTH_DAYS[pm - 1])


def _month_label(mid: str | None, month: str) -> str:
    return f"{'mid-' if mid else ''}{month.capitalize()}"


def _sentences(text: str) -> list[str]:
    """Split on a period that ends a sentence ("5pm. Closed ..."); times were already normalized, so "p.m." is gone."""
    return [s.strip() for s in re.split(r"\.(?:\s+|$)", text) if s.strip()]


def _two_seasons(start: tuple[int, int], end: tuple[int, int], label: str, season_week: dict, rest_week: dict) -> dict:
    return {"seasons": [
        {"from": _mmdd(start), "to": _mmdd(end), "label": label, "week": season_week},
        {"from": _mmdd(_day_after(end)), "to": _mmdd(_day_before(start)), "label": "Rest of year", "week": rest_week},
    ]}


def _parse_seasonal(sentences: list[str], raw: str) -> dict | None:
    """The two seasonal shapes seen in real rows, or None when the text has neither."""
    # Shape A: "<week>. Closed Sundays January-March[ and on all state holidays]."
    hits = [(m, s) for s in sentences if (m := _CLOSED_DAYS_IN_MONTHS_RE.match(s))]
    if hits:
        rest = [s for s in sentences if not _CLOSED_DAYS_IN_MONTHS_RE.match(s)]
        if len(hits) != 1 or len(rest) != 1:
            raise _Unparseable(f"a seasonal closure needs exactly one week beside it: {raw!r}")
        m = hits[0][0]
        day = _day_name(m.group(1))
        if day is None:
            raise _Unparseable(f"unrecognized day in seasonal closure: {m.group(1)!r} (from {raw!r})")
        base = _parse_week(rest[0], raw)
        reduced = {**base, day: None}
        label = f"{_month_label(m.group(2), m.group(3))}–{_month_label(m.group(4), m.group(5))}"
        return _two_seasons(_month_start(m.group(2), m.group(3)), _month_end(m.group(4), m.group(5)), label, reduced, base)
    # Shape B: "Summer (June-mid-August): <week>. Rest of year: <week>."
    if any(_LABELLED_SEASON_RE.match(s) for s in sentences):
        m = _LABELLED_SEASON_RE.match(sentences[0])
        rest = _REST_OF_YEAR_RE.match(sentences[1]) if len(sentences) == 2 else None
        if not m or not rest:
            raise _Unparseable(f"a labelled season needs exactly one 'Rest of year' week after it: {raw!r}")
        label = f"{m.group(1).strip()} ({_month_label(m.group(2), m.group(3))}–{_month_label(m.group(4), m.group(5))})"
        return _two_seasons(_month_start(m.group(2), m.group(3)), _month_end(m.group(4), m.group(5)), label,
                            _parse_week(m.group(6), raw), _parse_week(rest.group(1), raw))
    return None


def parse_hours_text(raw: str | None) -> ParsedHours:
    """Best-effort structured parse of one facility's hours_text. Returns
    `needs_review=True` (structured=None) for anything not confidently
    readable -- a parenthetical caveat, an open-ended time ("10am onward"),
    a season named without dates, or a shape this parser doesn't recognize --
    rather than guessing."""
    if not raw or not raw.strip():
        return ParsedHours(structured=None, needs_review=False, reason=None)
    text = _normalize(raw)
    try:
        if _UNDATED_SEASON_RE.search(text):
            raise _Unparseable(f"season named without dates, cannot be placed on the calendar: {raw!r}")
        sentences = [s for s in _sentences(text) if not _HOLIDAY_SENTENCE_RE.match(s)]
        # The only parenthetical read is a labelled season's date range; any other one is a caveat a human must judge.
        without_season_dates = [_LABELLED_SEASON_RE.sub("", s) for s in sentences]
        if any(_PAREN_RE.search(s) for s in without_season_dates):
            raise _Unparseable(f"parenthetical caveat present, not silently dropped: {raw!r}")
        if sentences and _ROUND_THE_CLOCK_RE.match(sentences[0]):
            if any(not _STAFF_CONTACT_RE.match(s) for s in sentences[1:]):
                raise _Unparseable(f"text after the round-the-clock sentence: {raw!r}")
            return ParsedHours(structured={d: ("00:00", "23:59") for d in DAY_ORDER}, needs_review=False)
        seasonal = _parse_seasonal(sentences, raw)
        if seasonal is not None:
            return ParsedHours(structured=seasonal, needs_review=False)
        if len(sentences) != 1:
            raise _Unparseable(f"more than one sentence, one week expected: {raw!r}")
        return ParsedHours(structured=_parse_week(sentences[0], raw), needs_review=False)
    except _Unparseable as exc:
        return ParsedHours(structured=None, needs_review=True, reason=str(exc))
