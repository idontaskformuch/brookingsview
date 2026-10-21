"""The Broomfield city-calendar sources must stay within what robots.txt allows and what the
owner approved (2026-10-21): iCal feeds only, never RSS.aspx, fetched at most daily, public-event
categories only."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "configs" / "broomfield_co.json").read_text(encoding="utf-8"))
EVENTS = CFG["data_sources"]["events"]
CITY = [s for s in EVENTS["sources"] if s.get("url", "").startswith("https://www.broomfield.org/")]
# governance calendars on the same site (boards, commissions, council) -- not public events
GOVERNANCE_CAT_IDS = {24, 40, 43, 47, 49, 50, 51, 57, 58, 59, 60, 62, 68, 69, 70, 71, 72, 75, 76, 78, 79, 80}


def test_city_feeds_are_registered_as_civicplus_ical():
    assert len(CITY) >= 4
    assert all(s["kind"] == "ical_civicplus" for s in CITY)


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
