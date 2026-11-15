"""sports/adapters/sportspress_calendar.py against the two Queen's Park calendar pages read 2026-11-15 (calendar table only).

Every value below is from a real row (CLAUDE.md rule 15). Edge cases without a real row change ONE field of a real row, named in the test."""
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from bs4 import BeautifulSoup

from sports import adapters, runner
from sports.config import validate_sports_config
from sports.http import PoliteHttp, SourceSkipped

ROOT = Path(__file__).parent.parent
FIX = Path(__file__).parent / "fixtures"
MEN = (FIX / "sports" / "queensparkfc_mens-combined-26-27.html").read_text(encoding="utf-8")
WOMEN = (FIX / "sports" / "queensparkfc_womens-combined-26-27.html").read_text(encoding="utf-8")
ROBOTS = (FIX / "robots" / "queensparkfc.txt").read_text(encoding="utf-8")
CFG = json.loads((ROOT / "configs" / "glasgow.json").read_text(encoding="utf-8"))
SOURCES = {s["program"]: s for s in CFG["sports"]["sources"] if s["adapter"] == "sportspress_calendar"}
UK = ZoneInfo("Europe/London")


class Net:
    def __init__(self, page, status=200):
        self.page, self.status, self.urls, self.sleeps, self.now = page, status, [], [], 0.0

    def get(self, url, ua):
        self.urls.append(url)
        return (200, ROBOTS) if url.endswith("/robots.txt") else (self.status, self.page if self.status == 200 else "")

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def http(self):
        return PoliteHttp("UA-test", get=self.get, sleep=self.sleep, clock=lambda: self.now)


def run(program="queens-park", page=None, net=None):
    params = adapters.merged_params(SOURCES[program])
    params["_http"] = (net or Net(page if page is not None else (MEN if program == "queens-park" else WOMEN))).http()
    return adapters.get("sportspress_calendar")(params)


def on(events, day):
    return next(e for e in events if e.start_at.astimezone(UK).date().isoformat() == day)


def edit_row(html, content_prefix, fn):
    """Change one real row (picked by its time[content] start) and return the page."""
    soup = BeautifulSoup(html, "html.parser")
    row = next(r for r in soup.select("tr.sp-row") if r.select_one("time.sp-event-date")["content"].startswith(content_prefix))
    fn(row)
    return str(soup)


def test_every_row_of_both_calendars_comes_through_without_problems():
    men, women = run(), run("queens-park-women")
    assert (len(men), len(women)) == (46, 24)
    for e in men + women:
        assert e.problems() == [] and e.source == "sportspress_calendar" and e.sport == "soccer"
        assert e.venue and e.venue != "N/A"  # the hidden second venue block ("N/A") is never read
    assert {e.gender for e in men} == {"men"} and {e.gender for e in women} == {"women"}
    assert len({e.source_uid for e in men}) == 46 and len({e.source_uid for e in women}) == 24


def test_upcoming_home_game_queens_park_v_livingston_21_november():
    e = on(run(), "2026-11-21")
    assert e.start_at.astimezone(UK).strftime("%H:%M:%S") == "15:00:00"  # content "2026-11-21T15:00:15+00:00": seconds dropped
    assert (e.home_program_id, e.away_name, e.away_program_id, e.home_name) == ("queens-park", "Livingston", None, None)
    assert (e.status, e.score_home, e.venue, e.competition, e.time_tba) == ("scheduled", None, "The city Stadium", "SPFL Championship", False)
    assert e.source_uid == "queens-park:2026-11-21:livingston"
    assert e.url == "https://queensparkfc.co.uk/calendar/mens-combined-26-27/"


def test_away_result_stenhousemuir_v_queens_park_14_november_is_final_with_the_home_score_first():
    e = on(run(), "2026-11-14")
    assert (e.home_name, e.away_program_id, e.score_home, e.score_away, e.status) == ("Stenhousemuir", "queens-park", 2, 0, "final")
    assert e.venue == "Ochilview Park"


def test_summer_kick_off_is_british_summer_time():
    e = on(run(), "2026-07-11")  # Queen's Park v Brora Rangers, content "2026-07-11T15:00:58+01:00"
    assert e.start_at.astimezone(ZoneInfo("UTC")).strftime("%H:%M") == "14:00" and e.competition == "Premier Sports Cup"


def test_women_tbd_cup_tie_22_november_has_no_clock_time():
    e = on(run("queens-park-women"), "2026-11-22")  # result cell "TBD", content "2026-11-22T15:22:16+00:00"
    assert e.time_tba and e.start_at.astimezone(UK).strftime("%H:%M") == "00:00"
    assert (e.home_program_id, e.away_name, e.competition) == ("queens-park-women", "Dundee United", "Women's Scottish Cup")
    assert e.venue == "Kirkintilloch Community Sport Complex"


def test_typographic_apostrophe_in_the_title_matches_the_configured_team():
    assert "Queen&#8217;s Park Women v St Johnstone" in WOMEN  # U+2019 as the page writes it
    assert on(run("queens-park-women"), "2026-12-13").away_name == "St Johnstone"


def test_postponed_in_the_result_cell():
    """Real row 21 Nov (Queen's Park v Livingston); only the result cell changed from "3:00 pm" to "Postponed"."""
    page = edit_row(MEN, "2026-11-21", lambda r: r.select_one(".sp-result").string.replace_with("Postponed"))
    assert on(run(page=page), "2026-11-21").status == "postponed"


def test_a_visible_kick_off_beats_the_clock_in_the_start():
    """Real row 21 Nov; only the result cell changed from "3:00 pm" to "12:30 pm"."""
    page = edit_row(MEN, "2026-11-21", lambda r: r.select_one(".sp-result").string.replace_with("12:30 pm"))
    assert on(run(page=page), "2026-11-21").start_at.astimezone(UK).strftime("%H:%M") == "12:30"


def test_no_visible_ground_gives_no_venue_and_the_hidden_na_is_not_used():
    """Real row 21 Nov; only the visible venue block removed (the hidden "N/A" block stays)."""
    page = edit_row(MEN, "2026-11-21", lambda r: r.select_one(".sp-event-venue").decompose())
    assert on(run(page=page), "2026-11-21").venue is None


def test_a_row_without_the_team_is_left_alone():
    """Real row 21 Nov; only the title changed to two other clubs."""
    page = edit_row(MEN, "2026-11-21", lambda r: r.select_one(".sp-event-title").string.replace_with("Partick Thistle v Livingston"))
    assert len(run(page=page)) == 45


def test_a_page_without_the_calendar_table_is_an_error_not_an_empty_season():
    with pytest.raises(ValueError):
        run(page="<html><body><p>Fixtures</p></body></html>")


def test_robots_first_then_one_read_and_no_delay():
    net = Net(MEN)
    run(net=net)
    assert net.urls == ["https://queensparkfc.co.uk/robots.txt", "https://queensparkfc.co.uk/calendar/mens-combined-26-27/"]
    assert net.sleeps == []


def test_a_403_is_a_no_and_is_not_retried():
    net = Net(MEN, status=403)
    with pytest.raises(SourceSkipped):
        run(net=net)
    assert net.urls.count("https://queensparkfc.co.uk/calendar/mens-combined-26-27/") == 1


def test_config_is_valid_and_each_calendar_is_its_own_source():
    assert validate_sports_config(CFG) == []
    ids = [runner.source_id(s) for s in CFG["sports"]["sources"]]
    assert "sportspress_calendar:queens-park" in ids and "sportspress_calendar:queens-park-women" in ids
    assert CFG["sports"]["source_priority"][:2] == ["sportmonks", "sportspress_calendar"]
    assert CFG["sports"]["collect"] is True and CFG["sports"]["enabled"] is False
