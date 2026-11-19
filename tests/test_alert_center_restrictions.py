"""scrapers/parsers/alert_center_restrictions.py (Fas 5 source 1, Broomfield fire + water restrictions).

Fixtures are excerpts of the two real pages as read 2026-11-19 (tests/fixtures/alert_center/, markup unchanged). Edge cases are
the same real page with the one changed thing named in the test (CLAUDE.md rule 15). The "data too old" case is the site's
(site/src/lib/restrictions.test.ts): the parser only records what it read and when.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scrapers import polite_fetch as pf
from scrapers.parsers.alert_center_restrictions import (
    AlertCenterRestrictionsParser,
    Unrecognised,
    parse_alert_page,
    parse_category_page,
)
from scrapers.runner import REGISTRY, _resolve_key

FIX = Path(__file__).parent / "fixtures"
FIRE_HTML = (FIX / "alert_center" / "broomfield_aid90_2026-11-19.html").read_text(encoding="utf-8")
WATER_HTML = (FIX / "alert_center" / "broomfield_cid9_2026-11-19.html").read_text(encoding="utf-8")
ROBOTS = (FIX / "robots" / "broomfield.txt").read_text(encoding="utf-8")
CONFIG = json.loads((Path(__file__).parent.parent / "configs" / "broomfield_co.json").read_text(encoding="utf-8"))
SOURCE = CONFIG["data_sources"]["restrictions"]
FIRE_URL, WATER_URL = (p["url"] for p in SOURCE["pages"])
ROBOTS_URL = "https://broomfield.org/robots.txt"
NOW = datetime(2026, 11, 19, 23, 0, tzinfo=timezone.utc)

# The real water page with its one alert taken out and its own counter at 0 (the two changed things).
WATER_NONE_HTML = WATER_HTML[:WATER_HTML.index('<li aria-labelledby="alertHeader_92"')] + WATER_HTML[WATER_HTML.index("</li>") + 5:]
WATER_NONE_HTML = WATER_NONE_HTML.replace('<span class="numAlerts">1  Alert</span>', '<span class="numAlerts">0  Alerts</span>')


class FakeSession:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, headers, timeout, allow_redirects, stream):
        self.calls.append(url)
        if url not in self.routes:
            raise ConnectionError("no route")
        status, body = self.routes[url]

        class R:
            status_code = status
            content = body.encode() if isinstance(body, str) else body
            encoding = "utf-8"
            headers = {}
            raw = None
        R.url = url
        return R()


def run(routes, slept=None):
    parser = AlertCenterRestrictionsParser({"town_id": "broomfield_co", "timezone": "America/Denver"}, SOURCE)
    session = FakeSession(routes)
    parser.fetcher = pf.PoliteFetcher("source", "broomfield_co", session=session, ledger=pf.MemoryLedger(), cache_dir=None,
                                      sleep=(slept.append if slept is not None else (lambda s: None)))
    parser.now = lambda: NOW
    fetched = parser.fetch()
    rows = {r["kind"]: r for r in parser.parse(fetched)}
    return rows, fetched, session


def test_level_1_fire_restriction_is_the_sources_own_title_and_date():
    rows, fetched, _ = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, WATER_HTML)})
    fire = rows["fire"]
    assert fire["state"] == "active"
    assert fire["title"] == "Level 1 Fire Restrictions in Effect"
    assert fire["since_text"] == "November 17, 2026 6:54 PM"  # the alert's date, not the 4:48 PM "Latest Update"
    assert fire["since_at"] == "2026-11-17T18:54:00-07:00"
    assert fire["source_url"] == FIRE_URL and fire["checked_at"] == NOW.isoformat() and fire["error"] is None
    assert fetched.docs_failed == 0


def test_water_drought_watch_from_the_category_page():
    rows, _, _ = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, WATER_HTML)})
    water = rows["water"]
    assert (water["state"], water["title"], water["since_text"], water["alert_count"]) == (
        "active", "Broomfield is Under a Drought Watch", "February 9, 2026 8:00 AM", 1)
    assert water["alert_url"] == "https://broomfield.org/AlertCenter.aspx?AID=Broomfield-is-Under-a-Drought-Watch-92"


def test_no_restriction_only_when_the_category_page_itself_says_zero():
    assert parse_category_page(WATER_NONE_HTML, "Water Restrictions and Drought Conditions", 9)["state"] == "none"
    rows, _, _ = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, WATER_NONE_HTML)})
    assert rows["water"]["state"] == "none" and rows["water"]["title"] is None


@pytest.mark.parametrize("answer, reason", [
    ((500, "Server Error"), "answered 500"),
    ((403, "Forbidden"), "refused"),
    (None, "nothing (no answer)"),  # no route: ConnectionError
])
def test_fetch_failure_is_unknown_never_none(answer, reason):
    routes = {ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML)}
    if answer is not None:
        routes[WATER_URL] = answer
    rows, fetched, _ = run(routes)
    assert rows["water"]["state"] == "unknown" and reason in rows["water"]["error"]
    assert rows["water"]["title"] is None
    assert rows["fire"]["state"] == "active"  # one page failing does not touch the other
    assert fetched.docs_failed == 1 and fetched.docs_attempted == 2


def test_both_pages_failing_marks_the_run_degraded():
    _, fetched, _ = run({ROBOTS_URL: (200, ROBOTS)})
    assert fetched.docs_failed == fetched.docs_attempted == 2


@pytest.mark.parametrize("change, html, expect", [
    ("singleAlert renamed", FIRE_HTML.replace("listing singleAlert", "listing oneAlert"), "div.singleAlert not found"),
    ("category heading changed", FIRE_HTML.replace("<h2>Fire Alerts and Restrictions</h2>", "<h2>Fire Alerts</h2>"),
     "category heading"),
    ("alert no longer marked 'on'", FIRE_HTML.replace('class="alert on noPhotos', 'class="alert noPhotos'), "not marked active"),
    ("title element gone", FIRE_HTML.replace('<h3 id="alertTitle_90">', '<h4 id="alertTitle_90">'), "h3 title"),
    ("not HTML at all", "\x00\x01 not a page", "div.singleAlert not found"),
])
def test_changed_fire_page_is_unknown_not_a_crash(change, html, expect):
    rows, _, _ = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, html), WATER_URL: (200, WATER_HTML)})
    assert rows["fire"]["state"] == "unknown", change
    assert "page structure changed" in rows["fire"]["error"] and expect in rows["fire"]["error"]


@pytest.mark.parametrize("change, html, expect", [
    ("category block renamed", WATER_HTML.replace("divCat_9", "divCat_10"), "divCat_9 not found"),
    ("counter gone", WATER_HTML.replace('<span class="numAlerts">1  Alert</span>', ""), "numAlerts"),
    ("counter disagrees with the list", WATER_HTML.replace("1  Alert</span>", "2  Alerts</span>"), "counter says 2"),
    ("counter 0 but an alert listed", WATER_HTML.replace("1  Alert</span>", "0  Alerts</span>"), "counter says 0"),
])
def test_changed_water_page_is_unknown_not_none(change, html, expect):
    with pytest.raises(Unrecognised, match=expect):
        parse_category_page(html, "Water Restrictions and Drought Conditions", 9)
    rows, _, _ = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, html)})
    assert rows["water"]["state"] == "unknown", change


def test_crawl_delay_10_between_the_two_pages_and_only_configured_urls():
    slept: list[float] = []
    _, _, session = run({ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, WATER_HTML)}, slept)
    assert session.calls == [ROBOTS_URL, FIRE_URL, WATER_URL]
    assert len([s for s in slept if s > 9.0]) >= 2  # robots -> fire and fire -> water, each about 10 s


def test_config_pages_avoid_every_disallowed_path_and_resolve_to_this_parser():
    assert REGISTRY[_resolve_key(SOURCE, "restrictions")].endswith(":AlertCenterRestrictionsParser")
    for page in SOURCE["pages"]:
        path = page["url"].split("broomfield.org", 1)[1].lower()
        assert path.startswith("/alertcenter.aspx?")
        for denied in ("/rss.aspx", "/civicalerts.aspx", "/calendar.aspx", "/map.aspx", "/common/modules/icalendar/"):
            assert not path.startswith(denied)
    assert parse_alert_page(FIRE_HTML, SOURCE["pages"][0]["category"])["state"] == "active"
