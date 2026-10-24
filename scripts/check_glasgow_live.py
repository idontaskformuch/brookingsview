"""Post-deploy check for the LIVE Glasgow site (last step of glasgow-scrape.yml).

Glasgow has no sitemap/freshness config like the US towns (check_deployed_content
needs a signature section and homepage links), so this checks the two things the
automated build must get right, on the real deployed pages:

  1. /weather/ shows today AND tomorrow in degC (a stale snapshot would show
     neither, or degF if the wrong provider ran).
  2. /events/ has no card that has already ended inside a data-hide-ended
     container (those lists are filtered at build time; a card that is over at
     check time means the build used stale data). "Recently" lists are not
     inside such a container and legitimately hold past events.

Usage: python -m scripts.check_glasgow_live [--url https://glasgowloop.co.uk]
Exit 1 on any failure, with the reasons on stderr.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

import requests

SITE_URL = "https://glasgowloop.co.uk"
TZ = ZoneInfo("Europe/London")
USER_AGENT = "ViewMediaBot (+https://glasgowloop.co.uk/contact)"


class _Collector(HTMLParser):
    """Collects forecast row names and event cards inside data-hide-ended boxes."""

    def __init__(self) -> None:
        super().__init__()
        self.forecast_names: list[str] = []
        self.forecast_temps: list[str] = []
        self.cards: list[tuple[str, str]] = []  # (data-start, data-end)
        self._stack: list[bool] = []  # per open element: is it a hide-ended box?
        self._capture: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if tag not in ("br", "img", "meta", "link", "input", "hr"):
            self._stack.append("data-hide-ended" in a)
        if "data-start" in a and any(self._stack[:-1]):
            self.cards.append((a["data-start"] or "", a.get("data-end") or ""))
        if "forecast__name" in cls:
            self._capture = "name"
        elif "forecast__temp" in cls:
            self._capture = "temp"

    def handle_endtag(self, tag):
        if self._stack:
            self._stack.pop()
        self._capture = None

    def handle_data(self, data):
        if self._capture == "name":
            self.forecast_names.append(data.strip())
        elif self._capture == "temp":
            self.forecast_temps.append(data.strip())


def parse(html: str) -> _Collector:
    c = _Collector()
    c.feed(html)
    return c


def check_weather(html: str) -> list[str]:
    c = parse(html)
    problems = []
    names = set(c.forecast_names)
    if not names & {"Today", "Tonight"}:
        problems.append(f"/weather/: no 'Today'/'Tonight' row (rows: {sorted(names)[:6]})")
    if not names & {"Tomorrow", "Tomorrow Night"}:
        problems.append("/weather/: no 'Tomorrow' row")
    temps = " ".join(c.forecast_temps)
    if not temps:
        problems.append("/weather/: no temperatures in the forecast list")
    elif "°F" in temps or "°F" in temps:
        problems.append("/weather/: temperatures in degF")
    elif not re.search(r"\d\s*°C", temps):
        problems.append("/weather/: temperatures not in degC")
    return problems


def _ends_at(start: datetime, end_raw: str) -> datetime:
    if end_raw:
        try:
            end = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
            if end > start:
                return end
        except ValueError:
            pass
    local = start.astimezone(TZ)
    if local.hour == 0 and local.minute == 0:  # date-only event: ends at next local midnight
        nxt = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return nxt.astimezone(timezone.utc)
    return start + timedelta(hours=3)


def check_events(html: str, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    problems = []
    for start_raw, end_raw in parse(html).cards:
        try:
            start = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        except ValueError:
            problems.append(f"/events/: unparseable data-start {start_raw!r}")
            continue
        if _ends_at(start, end_raw) < now:
            problems.append(f"/events/: ended event still listed (start {start_raw}, end {end_raw or '-'})")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=SITE_URL)
    args = ap.parse_args()
    problems: list[str] = []
    for path, fn in (("/weather/", check_weather), ("/events/", check_events)):
        r = requests.get(args.url + path, headers={"User-Agent": USER_AGENT}, timeout=30)
        if r.status_code != 200:
            problems.append(f"{path}: HTTP {r.status_code}")
            continue
        problems += fn(r.text)
    for p in problems:
        print(f"FAIL: {p}", file=sys.stderr)
    if not problems:
        print("Glasgow live check OK: forecast has today + tomorrow in degC, no ended events in live lists")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
