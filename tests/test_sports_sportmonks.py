"""sports/adapters/sportmonks.py (Glasgow, Scottish Premiership) against recorded Sportmonks answers (tests/fixtures/sports/sportmonks_*.json)."""
import json
from datetime import date
from pathlib import Path

import pytest

from sports import adapters, registry, runner
from sports.config import validate_sports_config
from sports.adapters import sportmonks
from sports.http import PoliteHttp, SourceSkipped

ROOT = Path(__file__).parent.parent
FIX = Path(__file__).parent / "fixtures" / "sports"
UPCOMING = json.loads((FIX / "sportmonks_upcoming.json").read_text(encoding="utf-8"))
RECENT = json.loads((FIX / "sportmonks_recent.json").read_text(encoding="utf-8"))
CFG = json.loads((ROOT / "configs" / "glasgow.json").read_text(encoding="utf-8"))
SOURCE = CFG["sports"]["sources"][0]
ROBOTS_ALLOW_ALL = "User-agent: *\nDisallow:\n"
SECRET = "SECRET-TOKEN-123"


class Net:
    """Fake network: `pages` is the list of JSON answers handed out in order; records URLs and the headers of every page request."""

    def __init__(self, pages, status=200):
        self.pages, self.status, self.calls, self.now = list(pages), status, [], 0.0

    def get(self, url, ua, headers=None):
        if url.endswith("/robots.txt"):
            return 200, ROBOTS_ALLOW_ALL
        self.calls.append((url, headers))
        return (self.status, json.dumps(self.pages[len(self.calls) - 1])) if self.status == 200 else (self.status, "")

    def http(self):
        return PoliteHttp("UA-test", get=self.get, sleep=lambda s: None, clock=lambda: self.now)


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setenv("SPORTMONKS_API_KEY", SECRET)


def params(net):
    p = adapters.merged_params(SOURCE)
    p["_http"] = net.http()
    return p


def fetch(pages, **kw):
    net = Net(pages, **kw)
    return net, sportmonks.fetch(params(net), today=date(2026, 10, 28))


def fixture_with(**changes):
    fx = json.loads(json.dumps(UPCOMING["data"][0]))
    fx.update(changes)
    return fx


def page(*fixtures, has_more=False, remaining=170):
    return {"data": list(fixtures), "pagination": {"has_more": has_more}, "rate_limit": {"remaining": remaining}}


def test_config_validates_and_the_adapter_is_registered():
    assert "sportmonks" in adapters.names()
    assert validate_sports_config(CFG) == []
    assert CFG["sports"]["enabled"] is False


def test_kickoff_is_converted_from_utc_to_europe_london_across_the_clock_change():
    summer = fixture_with(id=1, starting_at="2026-10-24 14:00:00")  # BST until 2026-10-25 01:00 UTC
    winter = fixture_with(id=2, starting_at="2026-10-28 19:45:00")  # GMT
    _, out = fetch([page(summer, winter)])
    by_uid = {e.source_uid: e for e in out}
    assert by_uid["sportmonks:1"].start_at.isoformat() == "2026-10-24T15:00:00+01:00"
    assert by_uid["sportmonks:2"].start_at.isoformat() == "2026-10-28T19:45:00+00:00"
    assert {e.tz for e in out} == {"Europe/London"}


def test_upcoming_fixture_maps_to_a_scheduled_event_with_facts_only():
    net, out = fetch([UPCOMING])
    assert len(out) == len(UPCOMING["data"]) and out.unread == []
    ev = next(e for e in out if e.source_uid == "sportmonks:19722758")
    assert (ev.home_name, ev.away_name, ev.venue) == ("St. Mirren", "Hibernian", "The Smisa Stadium")
    assert (ev.status, ev.score_home, ev.score_away) == ("scheduled", None, None)
    assert (ev.sport, ev.level, ev.gender, ev.competition, ev.program_id) == ("soccer", "pro", "men", "Scottish Premiership", "scottish-premiership")
    assert (ev.url, ev.time_tba, ev.neutral_site, ev.exhibition) == (None, False, False, False)
    assert ev.problems() == []
    assert "image_path" not in json.dumps(ev.__dict__, default=str)


def test_finished_fixture_gets_the_full_time_score_home_first():
    _, out = fetch([RECENT])
    ev = next(e for e in out if e.source_uid == "sportmonks:19722764")
    assert (ev.home_name, ev.away_name, ev.status, ev.score_home, ev.score_away) == ("St. Mirren", "Dundee", "final", 2, 1)


def test_states_postponed_cancelled_live_and_unknown():
    def mk(i, state):
        return fixture_with(id=i, state={"developer_name": state})

    _, out = fetch([page(mk(1, "POSTPONED"), mk(2, "CANCELLED"), mk(3, "INPLAY_1ST_HALF"), mk(4, "WHO_KNOWS"))])
    by = {e.source_uid: e.status for e in out}
    assert by == {"sportmonks:1": "postponed", "sportmonks:2": "cancelled", "sportmonks:3": "scheduled"}
    assert [u["slug"] for u in out.unread] == ["fixture 4"] and "unknown state" in out.unread[0]["reason"]


def test_state_tba_has_no_clock_time():
    _, out = fetch([page(fixture_with(id=9, state={"developer_name": "TBA"}, starting_at="2026-11-21 12:30:00"))])
    assert out[0].time_tba is True and out[0].start_at.isoformat() == "2026-11-21T00:00:00+00:00"


def test_fixtures_not_to_be_guessed_are_left_out_and_reported():
    final_without_score = fixture_with(id=5, state={"developer_name": "FT"}, scores=[])
    placeholder = fixture_with(id=6, placeholder=True)
    one_team = fixture_with(id=7, participants=fixture_with()["participants"][:1])
    _, out = fetch([page(final_without_score, placeholder, one_team)])
    assert list(out) == []
    assert sorted(u["slug"] for u in out.unread) == ["fixture 5", "fixture 6", "fixture 7"]
    assert all(u["program"] == "scottish-premiership" and u["sport"] == "soccer" and u["gender"] == "men" for u in out.unread)


def test_token_goes_in_the_header_only_never_in_a_url_or_an_error():
    net, _ = fetch([UPCOMING])
    url, headers = net.calls[0]
    assert headers["Authorization"] == SECRET and SECRET not in url
    assert "/fixtures/between/2026-09-28/2026-12-27?" in url and "fixtureLeagues:501" in url
    bad = Net([], status=500)
    with pytest.raises(RuntimeError) as err:
        sportmonks.fetch(params(bad), today=date(2026, 10, 28))
    assert SECRET not in str(err.value)


def test_missing_key_is_an_error(monkeypatch):
    monkeypatch.delenv("SPORTMONKS_API_KEY")
    with pytest.raises(RuntimeError, match="SPORTMONKS_API_KEY"):
        fetch([UPCOMING])


def test_a_403_is_a_no_without_retry():
    net = Net([], status=403)
    with pytest.raises(SourceSkipped):
        sportmonks.fetch(params(net), today=date(2026, 10, 28))
    assert len(net.calls) == 1


def test_unknown_answer_shape_fails_closed_but_a_plain_no_results_answer_is_empty():
    with pytest.raises(RuntimeError, match="unknown answer shape"):
        fetch([{"oops": 1}])
    _, out = fetch([{"message": "No result(s) found matching your request.", "rate_limit": {"remaining": 100}}])
    assert list(out) == [] and out.unread == []


def test_paging_follows_has_more_and_dedups_by_fixture_id():
    a, b = fixture_with(id=1), fixture_with(id=2)
    net, out = fetch([page(a, has_more=True), page(a, b)])
    assert len(net.calls) == 2 and sorted(e.source_uid for e in out) == ["sportmonks:1", "sportmonks:2"] and out.unread == []
    assert "page=1" in net.calls[0][0] and "page=2" in net.calls[1][0]


def test_stops_asking_at_the_request_reserve_and_reports_the_league_as_not_read():
    pages = [page(fixture_with(id=1), has_more=True, remaining=sportmonks.RATE_RESERVE), page(fixture_with(id=2))]
    net, out = fetch(pages)
    assert len(net.calls) == 1 and [e.source_uid for e in out] == ["sportmonks:1"]
    assert out.unread and out.unread[0]["slug"] == "fixtures" and "request budget" in out.unread[0]["reason"]


def test_a_run_never_uses_more_than_max_pages_requests_far_below_180_an_hour():
    pages = [page(fixture_with(id=i), has_more=True, remaining=170) for i in range(1, sportmonks.MAX_PAGES + 1)]
    net, out = fetch(pages)
    assert len(net.calls) == sportmonks.MAX_PAGES <= 12 and "page limit" in out.unread[0]["reason"]


class Cur:
    def __init__(self):
        self.sql = []

    def execute(self, sql, args=()):
        self.sql.append((" ".join(sql.split()), args))

    def fetchall(self):
        return []


def test_runner_writes_events_and_health_through_the_normal_path():
    net = Net([UPCOMING])
    cur = Cur()
    assert runner.run_source(cur, "glasgow", SOURCE, http=net.http()) == "ok"
    inserts = [a for s, a in cur.sql if s.startswith("INSERT INTO sport_events")]
    assert len(inserts) == len(UPCOMING["data"]) and all(a[0] == "glasgow" and a[1] == "sportmonks" for a in inserts)
    health = [a for s, a in cur.sql if s.startswith("INSERT INTO sport_sources_health")]
    assert health and health[0][1] == "sportmonks:scottish-premiership"


def test_sportmonks_is_on_the_no_redistribution_list():
    assert "sportmonks" in registry.no_redistribution()
    assert registry.redistributable("sportmonks") is False and registry.redistributable("internal") is True


def test_dry_run_calls_the_api_prints_what_would_be_written_and_touches_no_database(monkeypatch, capsys):
    import db.db as dbmod

    def no_db(*a, **k):
        raise AssertionError("--dry-run must not open a database connection")

    monkeypatch.setattr(dbmod, "get_conn", no_db)
    monkeypatch.setattr(dbmod, "declare_action", no_db)
    net = Net([UPCOMING])
    lines: list[str] = []
    outcome = runner.dry_run_town(CFG, http_factory=lambda s: net.http(), out=lines.append)  # the town is still sports.enabled=false
    assert outcome == {"sportmonks:scottish-premiership": "ok"}
    assert len(net.calls) == 1  # it did call the API
    text = "\n".join(lines)
    assert f"WOULD WRITE {len(UPCOMING['data'])} sport_events row(s)" in text and "nothing was written" in text
    assert "uid=sportmonks:" in text and SECRET not in text
    # the CLI path: same, and never reaches get_conn/declare_action
    monkeypatch.setattr(runner, "dry_run_town", lambda cfg: {"sportmonks:scottish-premiership": "ok"})
    assert runner.main(["--town", "glasgow", "--dry-run"]) == 0
    assert "ok" in capsys.readouterr().out


def test_dry_run_reports_a_refusal_without_retrying_and_still_writes_nothing():
    net = Net([UPCOMING], status=403)
    lines: list[str] = []
    assert runner.dry_run_town(CFG, http_factory=lambda s: net.http(), out=lines.append) == {"sportmonks:scottish-premiership": "skipped"}
    assert len(net.calls) == 1 and "skipped" in lines[0]


def test_the_configured_window_is_30_back_60_forward_and_the_call_is_one_league_50_a_page():
    net, _ = fetch([UPCOMING])
    url = net.calls[0][0]
    assert "per_page=50" in url and "filters=fixtureLeagues:501" in url
    assert params(net)["days_back"] == 30 and params(net)["days_forward"] == 60


def test_a_window_over_100_days_stops_with_a_clear_error_before_any_request():
    net = Net([UPCOMING])
    p = params(net)
    p["days_forward"] = 71  # 30 + 71 = 101 days: Sportmonks answers 422
    with pytest.raises(RuntimeError, match="at most 100"):
        sportmonks.fetch(p, today=date(2026, 10, 28))
    assert net.calls == []
    p["days_forward"] = 70  # exactly 100 is allowed
    sportmonks.fetch(p, today=date(2026, 10, 28))
    assert len(net.calls) == 1


def test_dry_run_prints_every_api_call_with_rate_limit_remaining_and_the_total_and_never_the_token():
    a, b = fixture_with(id=1), fixture_with(id=2)
    net = Net([page(a, has_more=True, remaining=150), page(b, remaining=149)])
    lines: list[str] = []
    runner.dry_run_town(CFG, http_factory=lambda s: net.http(), out=lines.append)
    text = "\n".join(lines)
    sid = "[dry-run sportmonks:scottish-premiership]"
    assert f"{sid} API call 1: 1 fixture(s), rate_limit.remaining=150" in lines
    assert f"{sid} API call 2: 1 fixture(s), rate_limit.remaining=149" in lines
    assert f"{sid} 2 API call(s) in total" in lines and len(net.calls) == 2
    assert SECRET not in text and "Authorization" not in text and "api.sportmonks.com" not in text


def test_dry_run_says_unknown_when_the_answer_carries_no_rate_limit():
    net = Net([{"data": [fixture_with(id=1)], "pagination": {"has_more": False}}])
    lines: list[str] = []
    runner.dry_run_town(CFG, http_factory=lambda s: net.http(), out=lines.append)
    assert any("API call 1:" in l and "rate_limit.remaining=unknown" in l for l in lines)


def test_dry_run_line_names_the_right_weekday_for_the_london_date():
    # 31 Oct 2026 is a Saturday, 25 Oct a Sunday, 21 Nov a Saturday (UTC -> Europe/London does not move these dates)
    net = Net([page(fixture_with(id=1, starting_at="2026-10-31 15:00:00"), fixture_with(id=2, starting_at="2026-10-25 12:00:00"),
                    fixture_with(id=3, starting_at="2026-11-21 15:00:00"))])
    lines: list[str] = []
    runner.dry_run_town(CFG, http_factory=lambda s: net.http(), out=lines.append)
    rows = [l.strip() for l in lines if "uid=sportmonks:" in l]
    assert [r.split(" ")[0] + " " + r.split(" ")[1] for r in rows] == ["Sun 2026-10-25", "Sat 2026-10-31", "Sat 2026-11-21"]


def test_glasgow_collects_but_does_not_show():
    sports = CFG["sports"]
    assert sports["collect"] is True and sports["enabled"] is False
    assert validate_sports_config(CFG) == []


def test_collect_alone_runs_the_sources_enabled_false_without_collect_does_not():
    net = Net([UPCOMING])
    cur = Cur()
    out = runner.run_town(cur, {**CFG, "sports": {**CFG["sports"], "collect": True, "enabled": False}}, http_factory=lambda s: net.http())
    assert out == {"sportmonks:scottish-premiership": "ok"} and any(s.startswith("INSERT INTO sport_events") for s, _ in cur.sql)
    idle = Cur()
    assert runner.run_town(idle, {**CFG, "sports": {**CFG["sports"], "collect": False, "enabled": False}}) == {} and idle.sql == []
    assert runner.run_town(idle, {**CFG, "sports": {k: v for k, v in CFG["sports"].items() if k != "collect"}}) == {} and idle.sql == []


def test_collect_must_be_a_boolean():
    bad = {**CFG, "sports": {**CFG["sports"], "collect": "yes"}}
    assert any("collect" in p for p in validate_sports_config(bad))


def test_a_real_run_prints_each_api_call_with_rate_limit_remaining_and_never_the_token(capsys):
    net = Net([page(fixture_with(id=1), has_more=True, remaining=170), page(fixture_with(id=2), remaining=169)])
    assert runner.run_source(Cur(), "glasgow", SOURCE, http=net.http()) == "ok"
    out = capsys.readouterr().out
    assert "API call 1: 1 fixture(s), rate_limit.remaining=170" in out and "API call 2: 1 fixture(s), rate_limit.remaining=169" in out
    assert "2 API call(s) in total" in out and SECRET not in out and "Authorization" not in out
