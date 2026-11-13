"""The Broomfield city-calendar sources are INERT since broomfield.org/robots.txt disallowed
/common/modules/icalendar/ (2026-10-21). The remaining checks keep the old shape rules (iCal URLs only,
never RSS.aspx, at most daily, public-event categories) for the day the city grants permission."""
import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "configs" / "broomfield_co.json").read_text(encoding="utf-8"))
EVENTS = CFG["data_sources"]["events"]
CITY = [s for s in EVENTS["sources"] if s.get("url", "").startswith("https://www.broomfield.org/")]
# governance calendars on the same site (boards, commissions, council) -- not public events
GOVERNANCE_CAT_IDS = {24, 40, 43, 47, 49, 50, 51, 57, 58, 59, 60, 62, 68, 69, 70, 71, 72, 75, 76, 78, 79, 80}


def test_city_feeds_are_inert_because_robots_txt_blocks_them():
    # broomfield.org/robots.txt has disallowed /common/modules/icalendar/ since 2026-10-21 (owner 2026-11-04):
    # a URL robots.txt blocks is never fetched, not even to test the status code.
    assert len(CITY) >= 4
    for s in CITY:
        assert s["kind"] == "blocked", s["name"]
        assert s.get("enabled") is False, s["name"]
    # The events source is on again for Chipper's Lanes only (owner 2026-11-13): every source that can be fetched is elsewhere.
    assert city_hosts_in_fetchable_sources(EVENTS["sources"]) == []
    compass = next(s for s in EVENTS["sources"] if s["name"] == "compass")
    assert compass["kind"] == "blocked" and not compass.get("enabled"), compass


def _urls(value):
    if isinstance(value, str):
        return [value] if value.lower().startswith(("http://", "https://")) else []
    if isinstance(value, list):
        return [u for v in value for u in _urls(v)]
    return []


def city_hosts_in_fetchable_sources(sources):
    """(name, url) for every broomfield.org host or subdomain (compass.broomfield.org) in ANY url field of a fetchable source:
    the fetchers read url, urls, listing_url and ical_base_url (scrapers/event_sources.py, glasgow_life_events.py)."""
    hits = []
    for s in sources:
        if s.get("kind") in ("blocked", "unconfirmed"):    # inert markers, never fetched (event_sources.py)
            continue
        for key, value in s.items():
            for url in _urls(value):
                host = (urlparse(url).hostname or "").rstrip(".")
                if host == "broomfield.org" or host.endswith(".broomfield.org"):
                    hits.append((s["name"], url))
    return hits


def test_guard_catches_compass_in_any_url_field_of_a_fetchable_source():
    # Real compass row (configs/broomfield_co.json), only the field named in each case changed.
    compass = next(s for s in EVENTS["sources"] if s["name"] == "compass")
    url = compass["url"]
    no_url = {k: v for k, v in compass.items() if k != "url"}
    cases = [
        {**compass, "kind": "ical"},
        {**no_url, "kind": "html_listing_ics", "listing_url": url},
        {**no_url, "kind": "html_listing_ics", "ical_base_url": url},
        {**no_url, "kind": "glasgow_life", "urls": [url]},
        {**compass, "kind": "ical", "url": url.replace("compass.", "")},
        {**compass, "kind": "ical", "url": url.replace("compass.broomfield.org", "COMPASS.Broomfield.ORG.")},
    ]
    for case in cases:
        assert city_hosts_in_fetchable_sources([case]), case
    # Not a city host: a name that only contains the string.
    assert city_hosts_in_fetchable_sources([{**compass, "kind": "ical", "url": "https://notbroomfield.org/events"}]) == []


def test_no_forbidden_or_non_feed_url():
    for s in CITY:
        assert "rss.aspx" not in s["url"].lower()          # forbidden by robots.txt
        assert s["url"].startswith("https://www.broomfield.org/common/modules/iCalendar/iCalendar.aspx?")
    for s in EVENTS["sources"]:
        assert "rss.aspx" not in s.get("url", "").lower()


def test_only_public_event_categories_not_governance_calendars():
    ids = {int(re.search(r"catID=(\d+)", s["url"]).group(1)) for s in CITY}
    assert ids and not (ids & GOVERNANCE_CAT_IDS)


def test_fetched_at_most_once_a_day():
    assert EVENTS["refresh_minutes"] >= 360   # a few times a day at the very most
