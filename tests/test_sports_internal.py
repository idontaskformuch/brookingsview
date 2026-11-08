"""sports/adapters/internal.py (gojacks provider) and sports/runner.py, against recorded schedule tables (no network)."""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from sports import adapters, check, runner
from sports.adapters import internal
from sports.http import PoliteHttp, SourceSkipped

FX = Path(__file__).parent / "fixtures" / "sports"
ROBOTS = (Path(__file__).parent / "fixtures" / "robots" / "gojacks.txt").read_text(encoding="utf-8")
SOURCE = json.loads((Path(__file__).parent.parent / "configs" / "brookings_sd.json").read_text(encoding="utf-8"))["sports"]["sources"][0]


def page(slug: str) -> str:
    return (FX / f"gojacks_{slug}.html").read_text(encoding="utf-8")


class Net:
    def __init__(self, status=200):
        self.status, self.sleeps, self.urls = status, [], []
        self.now = 0.0

    def get(self, url, ua):
        self.urls.append(url)
        if url.endswith("/robots.txt"):
            return 200, ROBOTS
        return self.status, page(url.split("/sports/")[1].split("/")[0]) if self.status == 200 else ""

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def http(self):
        return PoliteHttp("UA-test", get=self.get, sleep=self.sleep, clock=lambda: self.now)


@pytest.fixture(scope="module")
def events():
    params = adapters.merged_params(SOURCE)
    params["_http"] = Net().http()
    return adapters.get("internal")(params)


def test_counts_per_sport_and_every_event_is_valid(events):
    by = {}
    for e in events:
        by[(e.sport, e.gender)] = by.get((e.sport, e.gender), 0) + 1
        assert e.problems() == [] and e.source == "internal" and e.level == "college" and e.program_id == "sdsu"
    assert by == {("football", "men"): 12, ("basketball", "men"): 31, ("basketball", "women"): 32, ("volleyball", "women"): 29}
    assert len({e.source_uid for e in events}) == len(events)


def test_home_game_with_result_keeps_our_score_on_our_side(events):
    e = next(e for e in events if e.sport == "football" and e.away_name == "Stetson")
    assert (e.home_program_id, e.score_home, e.score_away, e.status) == ("sdsu", 70, 7, "final")
    assert e.start_at.astimezone(ZoneInfo("America/Chicago")) == datetime(2026, 8, 29, 18, 0, tzinfo=ZoneInfo("America/Chicago"))
    assert e.tz == "America/Chicago" and e.venue == "Brookings, S.D. (Dana J. Dykhouse Stadium)"


def test_away_game_puts_our_score_on_the_away_side(events):
    e = next(e for e in events if e.sport == "football" and e.home_name == "Northwestern")
    assert (e.away_program_id, e.score_away, e.score_home, e.status) == ("sdsu", 18, 34, "final")


def test_facts_only_no_text_or_media_fields_are_set(events):
    for e in events:
        assert e.url is None and e.competition is None and e.placing_text is None


def test_ranking_prefix_is_not_part_of_the_opponent_name():
    rec = {"starts_at": "2026-09-05T19:00:00-05:00", "opponent": "#3 Montana", "home_away": "home", "venue": "X", "result": ""}
    ev = internal._event(rec, "football", {"sport": "football", "gender": "men"}, {"program": "sdsu"})
    assert ev.away_name == "Montana" and ev.source_uid == "gojacks:football:2026-09-05:montana"


@pytest.mark.parametrize("text,expected", [
    ("W 70-7", ("final", 70, 7)), ("L 18-34", ("final", 18, 34)), ("W, 3-1", ("final", 3, 1)), ("T 20-20", ("final", 20, 20)),
    ("W 85-80 (OT)", ("final", 85, 80)), ("Postponed", ("postponed", None, None)), ("Canceled", ("cancelled", None, None)),
    ("N -", ("scheduled", None, None)), ("", ("scheduled", None, None)), (None, ("scheduled", None, None)), ("-", ("scheduled", None, None)),
])
def test_parse_result(text, expected):
    assert internal.parse_result(text) == expected


def test_fetch_waits_the_full_30_seconds_between_all_requests():
    net = Net()
    params = adapters.merged_params(SOURCE)
    params["_http"] = net.http()
    adapters.get("internal")(params)
    assert net.sleeps == [30.0, 30.0, 30.0, 30.0]          # robots.txt, then four sport pages, 30 s apart; never shortened
    assert len([u for u in net.urls if u.endswith("/schedule/text")]) == 4


def test_check_reports_events_and_crawl_delay():
    net = Net()
    problems, reports = check.check_town({"town_id": "brookings_sd", "sports": {**_cfg()}}, get=net.get, sleep=net.sleep)
    r = reports[0]
    assert problems == [] and r.events == 104 and r.crawl_delay == 30 and r.waited == pytest.approx(120, abs=1)
    assert "crawl-delay=30s" in r.line() and "events=104" in r.line()


def _cfg():
    return json.loads((Path(__file__).parent.parent / "configs" / "brookings_sd.json").read_text(encoding="utf-8"))["sports"]


# --- runner: skips and errors are logged in sport_sources_health --------------------------------------------------------------

class Cur:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))


def health_rows(cur):
    return [p for sql, p in cur.calls if "sport_sources_health" in sql]


def test_runner_logs_a_403_as_skipped_and_does_not_retry():
    net = Net(status=403)
    cur = Cur()
    assert runner.run_source(cur, "brookings_sd", SOURCE, http=net.http()) == "skipped"
    (row,) = health_rows(cur)
    assert row[1] == "internal:sdsu" and row[2].startswith("skipped:") and "403" in row[2]
    assert len([u for u in net.urls if u.endswith("/schedule/text")]) == 1
    assert not any("INSERT INTO sport_events" in sql for sql, _ in cur.calls)


def test_runner_logs_a_crawl_delay_above_max_as_skipped():
    net = Net()
    source = {**SOURCE, "max_crawl_delay": 20}
    cur = Cur()
    assert runner.run_source(cur, "brookings_sd", source, http=PoliteHttp("UA", get=net.get, sleep=net.sleep, max_crawl_delay=20)) == "skipped"
    assert "max_crawl_delay" in health_rows(cur)[0][2] and net.sleeps == []


def test_runner_writes_events_and_health_on_success():
    net = Net()
    cur = Cur()
    assert runner.run_source(cur, "brookings_sd", SOURCE, http=net.http()) == "ok"
    assert sum("INSERT INTO sport_events" in sql for sql, _ in cur.calls) == 104
    assert health_rows(cur)[0][3] == 104


def test_runner_does_nothing_for_a_disabled_sports_block():
    cur = Cur()
    assert runner.run_town(cur, {"town_id": "brookings_sd", "sports": {"enabled": False}}) == {}
    assert cur.calls == []


# --- time_tba / neutral_site ---------------------------------------------------------------------------------------------------

def test_tbd_and_empty_time_cells_become_time_tba_at_local_midnight(events):
    tba = [e for e in events if e.time_tba]
    assert tba, "the recorded 2026-27 schedules contain TBD / empty time cells"
    for e in tba:
        local = e.start_at.astimezone(ZoneInfo("America/Chicago"))
        assert (local.hour, local.minute) == (0, 0)
    assert all(not e.time_tba for e in events if e.start_at.astimezone(ZoneInfo("America/Chicago")).hour != 0)


def test_tba_event_is_built_from_the_cell_not_from_the_placeholder():
    rec = {"starts_at": "2026-11-28T12:00:00-06:00", "opponent": "Second Line Showcase", "home_away": "neutral", "venue": "New Orleans, La.",
           "result": "", "raw_data": {"time": "TBD", "at": "Neutral"}}
    ev = internal._event(rec, "mens-basketball", {"sport": "basketball", "gender": "men"}, {"program": "sdsu"})
    assert ev.time_tba and ev.neutral_site and ev.start_at.hour == 0 and ev.problems() == []
    assert ev.home_program_id == "sdsu" and ev.away_name == "Second Line Showcase"


def test_known_time_is_not_tba_and_home_is_not_neutral(events):
    stetson = next(e for e in events if e.away_name == "Stetson")
    assert not stetson.time_tba and not stetson.neutral_site
    assert any(e.neutral_site for e in events) and not any(e.neutral_site for e in events if e.venue and "Brookings" in e.venue)


def test_pt_ct_listing_lands_at_noon_central(events):
    e = next(e for e in events if e.away_name == "Villanova")
    assert e.start_at.astimezone(ZoneInfo("America/Chicago")).hour == 12
