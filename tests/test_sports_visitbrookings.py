"""sports/adapters/visitbrookings.py (internal provider `visitbrookings`) against a recorded slice of the Visit Brookings iCal feed."""
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from sports import adapters, runner
from sports.config import validate_sports_config
from sports.adapters import visitbrookings
from sports.http import PoliteHttp, SourceSkipped

ROOT = Path(__file__).parent.parent
FEED = (Path(__file__).parent / "fixtures" / "sports" / "visitbrookings_events.ics").read_text(encoding="utf-8")
ROBOTS = (Path(__file__).parent / "fixtures" / "robots" / "visitbrookings.txt").read_text(encoding="utf-8")
CFG = json.loads((ROOT / "configs" / "brookings_sd.json").read_text(encoding="utf-8"))
SOURCE = next(s for s in CFG["sports"]["sources"] if s["program"] == "sdsu-club-hockey")


class Net:
    def __init__(self, feed=FEED, status=200):
        self.feed, self.status, self.urls, self.sleeps, self.now = feed, status, [], [], 0.0

    def get(self, url, ua):
        self.urls.append(url)
        return (200, ROBOTS) if url.endswith("/robots.txt") else (self.status, self.feed if self.status == 200 else "")

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def http(self):
        return PoliteHttp("UA-test", get=self.get, sleep=self.sleep, clock=lambda: self.now)


def run(feed=FEED):
    params = adapters.merged_params(SOURCE)
    params["_http"] = Net(feed).http()
    return adapters.get("internal")(params)


def test_only_the_configured_club_team_comes_through():
    events = run()
    assert [e.away_name for e in events] == ["Creighton", "Augustana"]
    for e in events:
        assert e.problems() == []
        assert (e.source, e.sport, e.level, e.program_id, e.home_program_id, e.status) == ("internal", "hockey", "amateur", "sdsu-club-hockey", "sdsu-club-hockey", "scheduled")
        assert e.venue == "Larson Ice Center" and e.gender is None and not e.time_tba and e.score_home is None


def test_dedup_against_internal_sdsu_sdsu_football_is_in_the_feed_and_is_not_read():
    """'SDSU Football vs Indiana State' carries the Sports category too; internal:sdsu (gojacks.com) is its one source."""
    assert "SDSU Football vs Indiana State" in FEED and "CATEGORIES:Sports,University" in FEED
    assert not [e for e in run() if "indiana" in (e.away_name or "").lower()]


def test_category_decides_not_the_title():
    no_category = FEED.replace("CATEGORIES:Sports,University", "CATEGORIES:University")
    assert run(no_category) == []
    other_title = FEED.replace("SUMMARY:Jacks Club Hockey vs Creighton", "SUMMARY:Jacks Club Hockey Fan Night")
    assert [e.away_name for e in run(other_title)] == ["Augustana"]


def test_times_are_local_central_and_uid_is_the_posts_id_plus_date():
    e = run()[0]
    assert e.start_at.astimezone(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d %H:%M") == "2026-11-08 11:00"
    assert e.source_uid == "visitbrookings:10020482:2026-11-08"
    assert len({x.source_uid for x in run()}) == 2


def test_link_back_to_the_visit_brookings_event_page():
    assert [e.url for e in run()] == ["https://visitbrookingssd.com/event/jacks-club-hockey-vs-creighton/2026-11-08/",
                                      "https://visitbrookingssd.com/event/jacks-club-hockey-vs-augustana-3/"]


def test_an_away_listing_puts_the_club_on_the_away_side():
    feed = FEED.replace("SUMMARY:Jacks Club Hockey vs Augustana", "SUMMARY:Jacks Club Hockey at Augustana")
    e = run(feed)[1]
    assert (e.away_program_id, e.home_name, e.home_program_id) == ("sdsu-club-hockey", "Augustana", None) and e.problems() == []


def test_crawl_delay_two_seconds_is_waited_in_full_and_robots_allows_the_feed():
    net = Net()
    params = adapters.merged_params(SOURCE)
    params["_http"] = net.http()
    adapters.get("internal")(params)
    assert net.urls == ["https://visitbrookingssd.com/robots.txt", "https://visitbrookingssd.com/events/?ical=1"]
    assert net.sleeps and abs(sum(net.sleeps) - 2.0) < 1e-6


def test_a_403_is_a_no_and_is_not_retried():
    net = Net(status=403)
    params = adapters.merged_params(SOURCE)
    params["_http"] = net.http()
    with pytest.raises(SourceSkipped):
        adapters.get("internal")(params)
    assert net.urls.count("https://visitbrookingssd.com/events/?ical=1") == 1


def test_config_is_valid_and_the_two_sources_have_their_own_ids():
    assert validate_sports_config(CFG) == []
    ids = [runner.source_id(s) for s in CFG["sports"]["sources"]]
    assert ids == ["internal:sdsu", "internal:sdsu-club-hockey"]
    club = next(p for p in CFG["sports"]["programs"] if p["id"] == "sdsu-club-hockey")
    assert club["kind"] == "club" and club["level_default"] == "amateur"
