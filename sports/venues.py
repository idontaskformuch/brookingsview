"""Where a program's HOME game is played (owner 2026-11-15, sports-deep answers 8 F13 + 9 F16).

The venue comes from the source where the source names one; otherwise from config: `venue_overrides` first, then `home_venue`.
`venue_overrides` is filled in configs/<town>.json without a code change. Each entry is either one day (`date`, optionally
`opponent`) or a span (`from`, `to`, both inclusive, local dates), with `status`:
  "confirmed"   -- `venue`, `source_url` and a verbatim `quote` from that page are required;
  "unconfirmed" -- no venue: the game is shown as "venue to be confirmed" until a source names one.
A one-day entry beats a span, a span beats `home_venue`. Two entries of the same kind may not cover the same day.
"""
from __future__ import annotations

from datetime import date

STATUSES = ("confirmed", "unconfirmed")
_KEYS = {"date", "from", "to", "opponent", "status", "venue", "source_url", "quote", "note"}


def _day(value) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def validate_overrides(entries, where: str) -> list[str]:
    if not isinstance(entries, list):
        return [f"{where}: must be a list"]
    p: list[str] = []
    days: dict[date, int] = {}
    spans: list[tuple[date, date, int]] = []
    for i, e in enumerate(entries):
        at = f"{where}[{i}]"
        if not isinstance(e, dict):
            p.append(f"{at}: must be an object")
            continue
        p += [f"{at}.{k}: unknown key" for k in sorted(set(e) - _KEYS)]
        status = e.get("status")
        if status not in STATUSES:
            p.append(f"{at}.status: expected one of {', '.join(STATUSES)}")
        if status == "confirmed":
            for k in ("venue", "source_url", "quote"):
                if not (isinstance(e.get(k), str) and e[k].strip()):
                    p.append(f"{at}.{k}: required when status is confirmed")
        if status == "unconfirmed" and e.get("venue"):
            p.append(f"{at}.venue: an unconfirmed entry has no venue")
        if "source_url" in e and not str(e["source_url"]).startswith("https://"):
            p.append(f"{at}.source_url: must be an https URL")
        if "date" in e:
            if "from" in e or "to" in e:
                p.append(f"{at}: either date or from/to, not both")
            d = _day(e["date"])
            if d is None:
                p.append(f"{at}.date: YYYY-MM-DD")
            elif d in days:
                p.append(f"{at}.date: {d} already in entry {days[d]}")
            else:
                days[d] = i
        else:
            a, b = _day(e.get("from")), _day(e.get("to"))
            if a is None or b is None:
                p.append(f"{at}: needs date, or from and to (YYYY-MM-DD)")
            elif a > b:
                p.append(f"{at}: from is after to")
            else:
                for a2, b2, j in spans:
                    if a <= b2 and a2 <= b:
                        p.append(f"{at}: overlaps entry {j}")
                spans.append((a, b, i))
    return p


def home_venue(program: dict, day: date) -> tuple[str | None, str]:
    """(venue, how) for a home game on local date `day` whose source names no venue. how: "override" (confirmed entry),
    "unconfirmed" (shown as venue to be confirmed), "config" (home_venue) or "none" (no home_venue configured)."""
    entries = program.get("venue_overrides") or []
    hit = next((e for e in entries if _day(e.get("date")) == day), None)
    if hit is None:
        hit = next((e for e in entries if "date" not in e and _day(e.get("from")) <= day <= _day(e.get("to"))), None)
    if hit is not None:
        return (hit["venue"], "override") if hit["status"] == "confirmed" else (None, "unconfirmed")
    venue = program.get("home_venue")
    return (venue, "config") if venue else (None, "none")
