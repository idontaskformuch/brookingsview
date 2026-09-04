"""Deterministic parser: facilities.hours_text (free text, hand-curated by a
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
# Scoped to exactly the 3-letter abbreviations actually observed in real
# hours_text (see tests/test_facility_hours.py) -- not "tues"/"thurs"
# variants that would need alternation-order care to avoid a prefix match
# (e.g. "thu" matching first and leaving "rs" dangling) for no current benefit.
_DAY_TOKEN_RE = "|".join(_DAY_ABBR)

# En dash (–, U+2013) shows up in Brookings/Moreno Valley's hand-curated
# hours_text; Broomfield's uses a plain ASCII hyphen. Both serve double duty
# in this format (day range AND time range separator) -- normalized to one
# character up front rather than taught to every pattern below twice.
_EN_DASH_RE = re.compile("–")

_PAREN_RE = re.compile(r"\([^)]*\)")

_TIME_RE = re.compile(
    rf"(?:(\d{{1,2}})(?::(\d{{2}}))?\s*(am|pm)|(noon)|(midnight))", re.IGNORECASE,
)

_DAY_RANGE_RE = re.compile(
    rf"^({_DAY_TOKEN_RE})(?:-({_DAY_TOKEN_RE}))?$", re.IGNORECASE,
)

_CLOSED_DAY_RE = re.compile(rf"^closed\s+({_DAY_TOKEN_RE})\w*$", re.IGNORECASE)
_DAILY_RE = re.compile(r"^daily$", re.IGNORECASE)


@dataclass
class ParsedHours:
    # {day: (open_HHMM, close_HHMM) | None, ...} -- all 7 keys always
    # present when structured is not None. None overall means parsing
    # failed; check `needs_review`/`reason` for why.
    structured: dict[str, tuple[str, str] | None] | None
    needs_review: bool
    reason: str | None = None


def _parse_time(text: str) -> str | None:
    """"9am" -> "09:00", "6:30pm" -> "18:30", "noon" -> "12:00". None if
    `text` isn't a recognized time token at all (caller treats that as a
    parse failure, not a guess)."""
    m = _TIME_RE.match(text.strip())
    if not m or m.start() != 0 or m.end() != len(text.strip()):
        return None
    if m.group(4):  # noon
        return "12:00"
    if m.group(5):  # midnight
        return "00:00"
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    period = m.group(3).lower()
    if not (1 <= hour <= 12):
        return None
    if period == "am":
        hour = 0 if hour == 12 else hour
    else:
        hour = 12 if hour == 12 else hour + 12
    return f"{hour:02d}:{minute:02d}"


def _parse_time_range(text: str) -> tuple[str, str] | None:
    parts = re.split(r"\s*-\s*", text.strip(), maxsplit=1)
    if len(parts) != 2:
        return None
    open_t, close_t = _parse_time(parts[0]), _parse_time(parts[1])
    if open_t is None or close_t is None:
        return None
    return open_t, close_t


def _expand_day_range(token: str) -> list[str] | None:
    m = _DAY_RANGE_RE.match(token.strip())
    if not m:
        return None
    start = _DAY_ABBR[m.group(1).lower()]
    if m.group(2) is None:
        return [start]
    end = _DAY_ABBR[m.group(2).lower()]
    i, j = DAY_ORDER.index(start), DAY_ORDER.index(end)
    if j < i:
        return None  # a real range never wraps Sun->Mon in this dataset -- treat as unparseable rather than guess the intent
    return DAY_ORDER[i:j + 1]


def parse_hours_text(raw: str | None) -> ParsedHours:
    """Best-effort structured parse of one facility's hours_text. Returns
    `needs_review=True` (structured=None) for anything not confidently
    readable -- a parenthetical caveat, an open-ended time ("10am onward"),
    or a shape this parser doesn't recognize -- rather than guessing."""
    if not raw or not raw.strip():
        return ParsedHours(structured=None, needs_review=False, reason=None)

    text = _EN_DASH_RE.sub("-", raw.strip())

    if _PAREN_RE.search(text):
        return ParsedHours(
            structured=None, needs_review=True,
            reason=f"parenthetical caveat present, not silently dropped: {raw!r}",
        )

    days: dict[str, tuple[str, str] | None] = {d: None for d in DAY_ORDER}
    covered: set[str] = set()

    for raw_group in text.split(","):
        group = raw_group.strip()
        if not group:
            continue

        m = _CLOSED_DAY_RE.match(group)
        if m:
            day = _DAY_ABBR[m.group(1).lower()]
            days[day] = None
            covered.add(day)
            continue

        tokens = group.split(None, 1)
        if len(tokens) != 2:
            return ParsedHours(
                structured=None, needs_review=True,
                reason=f"unrecognized fragment: {group!r} (from {raw!r})",
            )
        day_token, time_token = tokens

        if _DAILY_RE.match(day_token):
            day_list = DAY_ORDER
        else:
            day_list = _expand_day_range(day_token)
            if day_list is None:
                return ParsedHours(
                    structured=None, needs_review=True,
                    reason=f"unrecognized day spec: {day_token!r} (from {raw!r})",
                )

        time_range = _parse_time_range(time_token)
        if time_range is None:
            return ParsedHours(
                structured=None, needs_review=True,
                reason=f"unrecognized or open-ended time range: {time_token!r} (from {raw!r})",
            )

        for day in day_list:
            days[day] = time_range
            covered.add(day)

    if not covered:
        return ParsedHours(
            structured=None, needs_review=True, reason=f"no day/time groups recognized: {raw!r}",
        )

    # Days never mentioned at all default to closed -- the standard,
    # near-universal convention for posted hours (an office listing Mon-Fri
    # hours and saying nothing about the weekend means closed weekends, not
    # "unknown"). This is an interpretation of a real-world convention, not
    # a guess about a VALUE -- see module docstring.
    return ParsedHours(structured=days, needs_review=False, reason=None)
