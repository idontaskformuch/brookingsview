"""Story meta from a source's own structured fields, no model (owner 2026-11-18, specs/us-christmas-2026.md "Beslut steg 2", G4).

A row the model gate (scrapers/llm_gate.py) keeps away from the model gets its meta here instead of from meta_only's model call.
One mapping per source format; a field the format does not carry, or that is empty, stays out (nothing without data):

  ICS (ical, ical_civicplus, html_listing_ics):
    venue <- LOCATION (events.venue)
    when  <- DTSTART/DTEND, only when the event runs over several days (an all-day DTEND is exclusive)
    cost  <- a labelled DESCRIPTION line ("Cost:", "Price:", "Admission:", "Tickets:", "Fee:") that states a price or "free"
  tribe REST (tribe_rest):
    venue <- venue (events.venue), when <- start_date/end_date as above, cost <- cost (or the source's own **FREE** mark),
    registration <- website (raw_data.ticket_url)

Values are copied as written; the same keys meta_only asks the model for, so the page reads them the same way.
"""
from __future__ import annotations

import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

ICS_KINDS = frozenset({"ical", "ical_civicplus", "html_listing_ics"})
TRIBE_KINDS = frozenset({"tribe_rest"})
MAX_VALUE_CHARS = 200  # same cap as meta_only

_COST_LINE_RE = re.compile(r"(?im)^[ \t]*(?:cost|price|prices|admission|tickets?|fees?)[ \t]*:[ \t]*(.+?)[ \t]*$")
_PRICE_RE = re.compile(r"[$£€]\s?\d|\d+(?:\.\d{2})?\s?(?:usd|gbp|dollars?)\b|\bfree\b", re.I)


def source_kind(cfg: dict, source_name: str | None) -> str | None:
    for src in ((cfg.get("data_sources") or {}).get("events") or {}).get("sources", []):
        if src.get("name") == source_name:
            return src.get("kind")
    return None


def _local(value, tz: ZoneInfo) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.astimezone(tz) if value.tzinfo else value.replace(tzinfo=tz)


def _day(d: datetime, with_year: bool) -> str:
    return f"{d:%b} {d.day}, {d.year}" if with_year else f"{d:%b} {d.day}"


def span_when(starts_at, ends_at, tz: ZoneInfo) -> str | None:
    """"Nov 20 – Nov 22" when the event covers more than one local day; None for a single day or a missing end."""
    start, end = _local(starts_at, tz), _local(ends_at, tz)
    if start is None or end is None or end <= start:
        return None
    last = end.date()
    if end.time() == time(0, 0):  # all-day DTEND (and a midnight end) is exclusive
        last -= timedelta(days=1)
    if last <= start.date():
        return None
    years = start.year != last.year
    end_dt = datetime.combine(last, time(0, 0))
    return f"{_day(start, years)} – {_day(end_dt, years)}"


def _clip(v) -> str | None:
    if not isinstance(v, str):
        return None
    v = v.strip()
    return v if v and len(v) <= MAX_VALUE_CHARS else None


def labelled_cost(description: str | None) -> str | None:
    for m in _COST_LINE_RE.finditer(description or ""):
        value = m.group(1).strip().rstrip(".")
        if _PRICE_RE.search(value):
            return "Free" if re.fullmatch(r"free", value, re.I) else _clip(value)
    return None


def meta_from_source(row: dict, kind: str | None, tz: ZoneInfo) -> dict:
    """The meta a gated event row gets, from its own structured fields only."""
    raw = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    meta: dict[str, str] = {}
    if kind not in ICS_KINDS and kind not in TRIBE_KINDS:
        return meta
    venue = _clip(row.get("venue"))
    if venue:
        meta["venue"] = venue
    if not row.get("is_recurring_series"):  # a series lists its own dates (series_dates)
        when = span_when(row.get("starts_at"), row.get("ends_at"), tz)
        if when:
            meta["when"] = when
    if kind in ICS_KINDS:
        cost = labelled_cost(raw.get("description"))
    else:
        cost = _clip(raw.get("cost")) or ("Free" if raw.get("free") else None)
        registration = _clip(raw.get("ticket_url"))
        if registration:
            meta["registration"] = registration
    if cost:
        meta["cost"] = cost
    return meta
