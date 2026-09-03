"""Phase 0 check 3: date coherence.

"'today', 'tonight', 'tomorrow', 'this weekend' and any weekday in a
headline or lede must match the record's date in that town's timezone." --
Recurring-traffic layer handoff.

Scoped to the headline + first sentence (the "lede") deliberately, not the
whole body -- a later paragraph can legitimately reference a different day
("the committee last met on Tuesday"); it's the OPENING framing that asserts
"this is when this piece is about," and that's the one claim that must match
the record's real date. `record_date` and `reference_now` are both required
tz-aware datetimes in the town's own timezone (or convertible to it) --
comparing calendar DATES needs the town's local calendar day, not UTC's;
see publish.py's own ZoneInfo(cfg["timezone"]) pattern, reused here rather
than a new one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass
class CheckResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

_LEDE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _lede(text: str) -> str:
    """Headline + first sentence of the body -- see module docstring for why
    only the opening framing is checked. `text` may be just a title, just a
    body, or "title\\n\\nbody" (content/_base.py's own split shape); either
    way, taking the first sentence of whatever's given covers all three."""
    parts = _LEDE_SPLIT_RE.split(text.strip(), maxsplit=1)
    return parts[0] if parts else ""


def _word_boundary_search(term: str, text: str) -> bool:
    return re.search(r"\b" + re.escape(term) + r"\b", text, re.IGNORECASE) is not None


def _as_local_date(value: datetime, tz: ZoneInfo) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=tz)
    return value.astimezone(tz).date()


def check_date_coherence(
    text: str,
    record_date: datetime | None,
    cfg: dict,
    *,
    reference_now: datetime | None = None,
) -> CheckResult:
    if record_date is None:
        return CheckResult(passed=True)  # nothing to check a relative-day word against

    tz = ZoneInfo((cfg or {}).get("timezone", "America/Chicago"))
    record_local = _as_local_date(record_date, tz)
    now_local = _as_local_date(reference_now or datetime.now(tz), tz)

    lede = _lede(text)
    violations: list[str] = []

    if _word_boundary_search("today", lede) or _word_boundary_search("tonight", lede):
        if record_local != now_local:
            violations.append(
                f"lede says 'today'/'tonight' but the record's date ({record_local}) "
                f"isn't today ({now_local}) in the town's timezone"
            )

    if _word_boundary_search("tomorrow", lede):
        expected = now_local + timedelta(days=1)
        if record_local != expected:
            violations.append(
                f"lede says 'tomorrow' but the record's date ({record_local}) "
                f"isn't tomorrow ({expected}) in the town's timezone"
            )

    if _word_boundary_search("this weekend", lede):
        # The nearest upcoming (or current) Saturday/Sunday relative to `now`
        # -- Monday's "this weekend" means the coming Sat/Sun, and Saturday's
        # "this weekend" still means today/tomorrow, never last weekend.
        days_to_saturday = (5 - now_local.weekday()) % 7
        saturday = now_local + timedelta(days=days_to_saturday)
        sunday = saturday + timedelta(days=1)
        if record_local not in (saturday, sunday):
            violations.append(
                f"lede says 'this weekend' but the record's date ({record_local}) "
                f"isn't the coming Saturday/Sunday ({saturday}/{sunday})"
            )

    record_weekday = _WEEKDAY_NAMES[record_local.weekday()]
    for weekday_name in _WEEKDAY_NAMES:
        if weekday_name == record_weekday:
            continue
        if _word_boundary_search(weekday_name, lede):
            violations.append(
                f"lede names '{weekday_name}' but the record's date ({record_local}) "
                f"is actually a {record_weekday}"
            )

    return CheckResult(passed=len(violations) == 0, violations=violations)
