"""scripts/check_freshness.py: limits, the token date, which jobs are active, and (qa/report.py) that the watchdogs never close each other's issues."""
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from qa.report import CLEAN_MARK, REGISTRY, fingerprint, group, plan_actions, render_issue
from scripts import check_freshness as cf

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------- limits

@pytest.mark.parametrize("kind,hours", [("sport", 26), ("weather", 3), ("alerts", 2), ("safety", 3)])
def test_limits_are_the_agreed_ones(kind, hours):
    assert cf.LIMIT_HOURS[kind] == hours


@pytest.mark.parametrize("kind", ["sport", "weather", "alerts", "safety"])
def test_exactly_at_limit_is_fresh_just_over_is_stale(kind):
    h = cf.LIMIT_HOURS[kind]
    assert not cf.is_stale(NOW - timedelta(hours=h), NOW, h)
    assert cf.is_stale(NOW - timedelta(hours=h, minutes=1), NOW, h)


def test_never_succeeded_is_stale():
    assert cf.is_stale(None, NOW, 36)
    f = cf.stale_finding("alerts", "glasgow", "alerts", None, NOW)
    assert f["check"] == "ops.alerts-freshness" and "never" in f["message"] and "2 h" in f["message"]


def test_weather_timestamp_parses_the_workers_z_suffix():
    assert cf._parse_ts("2026-11-08T13:00:51Z") == datetime(2026, 11, 8, 13, 0, 51, tzinfo=timezone.utc)
    assert cf._parse_ts(None) is None and cf._parse_ts("") is None


# ---------------------------------------------------------------- token

def test_token_issue_opens_from_2027_09_21_and_not_a_day_earlier():
    assert cf.TOKEN_EXPIRES == date(2027, 10, 21)
    assert cf.token_findings(date(2027, 9, 20)) == []
    first = cf.token_findings(date(2027, 9, 21))
    assert len(first) == 1 and first[0]["check"] == "ops.token-expiry" and "expires in 30 days" in first[0]["message"]
    assert "expires today" in cf.token_findings(date(2027, 10, 21))[0]["message"]
    assert "has expired" in cf.token_findings(date(2027, 11, 1))[0]["message"]
    assert cf.token_findings(date(2026, 11, 8)) == []


# ---------------------------------------------------------------- active jobs mirror the Worker and the configs

def towns_in(ts_path: str) -> list[str]:
    return re.findall(r"townId: '([a-z_]+)'", (ROOT / ts_path).read_text(encoding="utf-8"))


def test_town_lists_mirror_the_worker():
    assert cf.ALERT_TOWNS == towns_in("cron-dispatcher/src/alerts/towns.ts")
    assert cf.WEATHER_TOWNS == towns_in("cron-dispatcher/src/weather/towns.ts")
    assert cf.SAFETY_TOWNS == towns_in("cron-dispatcher/src/safety/towns.ts")


def test_sport_sources_are_exactly_the_enabled_ones_in_the_configs():
    got = cf.sport_sources()
    assert ("brookings_sd", "internal:sdsu") in got
    for town in cf.ALL_TOWNS:
        block = json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8")).get("sports") or {}
        mine = [s for t, s in got if t == town]
        assert bool(mine) == (block.get("enabled") is True or block.get("collect") is True)


def test_sport_sources_skip_a_disabled_town(tmp_path):
    for town in cf.ALL_TOWNS:
        (tmp_path / f"{town}.json").write_text(json.dumps({"sports": {"enabled": False, "sources": [{"adapter": "internal", "program": "x"}]}}), encoding="utf-8")
    assert cf.sport_sources(tmp_path) == []


def test_sport_sources_include_a_collect_only_town(tmp_path):
    for town in cf.ALL_TOWNS:
        (tmp_path / f"{town}.json").write_text(json.dumps({"sports": {"enabled": False, "collect": True, "sources": [{"adapter": "sportmonks", "program": "p"}]}}), encoding="utf-8")
    assert {s for _, s in cf.sport_sources(tmp_path)} == {"sportmonks:p"}


def test_every_check_id_is_in_the_qa_registry_as_hard():
    for cid in cf.FRESHNESS_CHECKS:
        assert REGISTRY[cid]["severity"] == "hard" and REGISTRY[cid]["born_from"] and REGISTRY[cid]["what"]


# ---------------------------------------------------------------- issues do not close each other

def issue_for(finding: dict, comments=None) -> dict:
    fp = fingerprint(finding)
    _, body = render_issue(fp, group([finding])[fp])
    return {"number": 1, "body": body, "comments": comments if comments is not None else [CLEAN_MARK] * 5}


ALL_TOWNS_SCOPE = set(cf.ALL_TOWNS) | {cf.TOKEN_TOWN}


def test_each_freshness_check_has_its_own_fingerprint_for_the_same_town():
    fps = {fingerprint(cf.stale_finding(k, "moreno_valley_ca", k, None, NOW)) for k in ("weather", "alerts", "safety")}
    assert len(fps) == 3
    assert fingerprint(cf.stale_finding("alerts", "moreno_valley_ca", "alerts", None, NOW)) != fingerprint(
        {"check": "ops.scrape-liveness", "town": "moreno_valley_ca", "pattern": "moreno_valley_ca"})


def test_freshness_run_never_closes_scrape_liveness_or_web_qa_issues():
    scrape = issue_for({"check": "ops.scrape-liveness", "town": "brookings_sd", "pattern": "brookings_sd"})
    web = issue_for({"check": "web.noindex-sitemap", "town": "brookings_sd", "pattern": "/s/*", "path": "/s/a/"})
    in_scope = lambda c: c in cf.FRESHNESS_CHECKS  # noqa: E731
    assert plan_actions([], [scrape, web], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=in_scope) == []


def test_scrape_and_qa_runs_never_close_a_freshness_issue():
    stale = issue_for(cf.stale_finding("weather", "brookings_sd", "weather", None, NOW))
    assert plan_actions([], [stale], clean_to_close=2, scope_towns={"brookings_sd"}, scope_checks=lambda c: c == "ops.scrape-liveness") == []
    assert plan_actions([], [stale], clean_to_close=3, scope_towns={"brookings_sd"}, scope_checks=lambda c: not c.startswith("ops.")) == []


def test_a_freshness_issue_does_close_after_two_clean_runs_in_its_own_scope():
    stale = issue_for(cf.stale_finding("weather", "brookings_sd", "weather", None, NOW), comments=[CLEAN_MARK])
    acts = plan_actions([], [stale], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c in cf.FRESHNESS_CHECKS)
    assert [a["op"] for a in acts] == ["close"]


def test_a_run_with_only_some_checks_leaves_the_others_issues_alone():
    # --only sport weather: the open alerts issue must not be commented clean just because alerts were not checked
    alerts = issue_for(cf.stale_finding("alerts", "glasgow", "alerts", None, NOW), comments=[])
    only = {cf.CHECK_ID[k] for k in ("sport", "weather")}
    assert plan_actions([], [alerts], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c in only) == []


def test_the_token_issue_is_in_scope_for_its_own_run_and_closes_itself():
    tok = issue_for(cf.token_findings(date(2027, 9, 25))[0], comments=[CLEAN_MARK])
    acts = plan_actions([], [tok], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c in cf.FRESHNESS_CHECKS)
    assert [a["op"] for a in acts] == ["close"]


def test_existing_callers_keep_their_old_behaviour_without_scope_checks():
    stale = issue_for(cf.stale_finding("weather", "brookings_sd", "weather", None, NOW), comments=[CLEAN_MARK])
    assert [a["op"] for a in plan_actions([], [stale], clean_to_close=2, scope_towns={"brookings_sd"})] == ["close"]


def test_workflow_runs_every_third_hour_on_an_odd_minute_and_only_the_freshness_script():
    yml = (ROOT / ".github" / "workflows" / "freshness-check.yml").read_text(encoding="utf-8")
    m = re.search(r'cron: "(\d+) \*/3 \* \* \*"', yml)
    assert m and int(m.group(1)) % 2 == 1
    assert "python -m scripts.check_freshness" in yml and "issues: write" in yml


def test_heartbeat_job_names_match_the_worker():
    ts = (ROOT / "cron-dispatcher" / "src" / "heartbeat.ts").read_text(encoding="utf-8")
    jobs = re.search(r"HEARTBEAT_JOBS = \[([^\]]*)\]", ts).group(1)
    assert re.findall(r"'([a-z]+)'", jobs) == ["alerts", "safety"]
    sql = (ROOT / "scripts" / "check_freshness.py").read_text(encoding="utf-8")
    assert '(("alerts", ALERT_TOWNS), ("safety", SAFETY_TOWNS))' in sql


def test_migration_069_has_the_columns_the_worker_and_the_check_use():
    sql = (ROOT / "db" / "migrations" / "069_dispatcher_heartbeat.sql").read_text(encoding="utf-8")
    for col in ("town_id", "job", "last_ok", "last_error", "last_error_at", "PRIMARY KEY (town_id, job)"):
        assert col in sql


# ---------------------------------------------------------------- evening register (owner 2026-11-08)

def conf(days: float) -> datetime:
    return NOW - timedelta(days=days)


def test_register_minimums_margins_and_towns_are_the_agreed_ones():
    assert cf.REGISTER_MIN_VENUES == {"glasgow": 4, "broomfield_co": 1}
    assert (cf.REGISTER_DATED_DAYS, cf.REGISTER_RECURRING_DAYS, cf.REGISTER_CHECK_MAX_DAYS) == (8, 36, 9)
    assert cf.CHECK_ID["register"] == "ops.evening-register-freshness"


def test_register_towns_are_exactly_the_configs_with_venues_and_all_have_a_minimum():
    assert set(cf.register_towns()) == set(cf.REGISTER_MIN_VENUES)


def test_dated_rule_counts_eight_days_recurring_thirty_six():
    assert cf.valid_register_venues([("a", "dated", conf(8))], NOW) == {"a"}
    assert cf.valid_register_venues([("a", "dated", conf(8.01))], NOW) == set()
    assert cf.valid_register_venues([("b", "recurring", conf(36))], NOW) == {"b"}
    assert cf.valid_register_venues([("b", "recurring", conf(36.01))], NOW) == set()
    # the state of 2026-11-08: dated rules confirmed 10-29 (10 days) are out, the recurring one (10 days) is in
    assert cf.valid_register_venues([("citizens", "dated", conf(10)), ("nns", "recurring", conf(10))], NOW) == {"nns"}


def test_a_venue_counts_once_however_many_rules_it_has_and_unknown_kinds_never_count():
    rows = [("a", "dated", conf(1)), ("a", "dated", conf(2)), ("a", "recurring", conf(3)), ("z", "other", conf(1)), ("n", "dated", None)]
    assert cf.valid_register_venues(rows, NOW) == {"a"}


def test_glasgow_alarms_below_four_not_at_four():
    assert cf.register_findings("glasgow", 4, conf(1), NOW) == []
    f = cf.register_findings("glasgow", 3, conf(1), NOW)
    assert len(f) == 1 and f[0]["check"] == "ops.evening-register-freshness" and "only 3" in f[0]["message"] and "minimum 4" in f[0]["message"]


def test_broomfield_alarms_only_at_zero():
    assert cf.register_findings("broomfield_co", 1, conf(1), NOW) == []
    assert len(cf.register_findings("broomfield_co", 0, conf(1), NOW)) == 1


def test_last_check_alarm_at_more_than_nine_days_or_never():
    assert cf.register_findings("glasgow", 7, conf(9), NOW) == []
    old = cf.register_findings("glasgow", 7, conf(9.01), NOW)
    assert len(old) == 1 and "last venue check" in old[0]["message"]
    assert "never" in cf.register_findings("glasgow", 7, None, NOW)[0]["message"]


def test_both_register_alarms_of_a_town_land_in_one_issue_a_different_town_in_another():
    both = cf.register_findings("glasgow", 0, None, NOW)
    assert len(both) == 2 and len({fingerprint(x) for x in both}) == 1
    assert len(group(both)) == 1
    assert fingerprint(both[0]) != fingerprint(cf.register_findings("broomfield_co", 0, None, NOW)[0])


def test_register_issue_is_in_the_freshness_scope_and_never_closed_by_other_runs():
    f = cf.register_findings("glasgow", 0, None, NOW)[0]
    stale = issue_for(f, comments=[CLEAN_MARK])
    assert [a["op"] for a in plan_actions([], [stale], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c in cf.FRESHNESS_CHECKS)] == ["close"]
    assert plan_actions([], [stale], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c == "ops.scrape-liveness") == []


# ---------------------------------------------------------------- ops.sport-warning: the same `warning:` for more than 3 days

WARN = "warning: mens-basketball: not read (RuntimeError: /sports/mens-basketball/schedule/text answered None (after one retry)); its rows were left as they were"


def test_a_warning_older_than_three_days_opens_a_finding_that_names_the_source_and_the_warning():
    f = cf.sport_warning_finding("brookings_sd", "internal:sdsu", WARN, NOW - timedelta(days=3, minutes=1), NOW)
    assert f["check"] == "ops.sport-warning" == cf.CHECK_ID["sportwarn"] and f["town"] == "brookings_sd" and f["pattern"] == "internal:sdsu"
    assert "mens-basketball" in f["message"] and "3.0 days" in f["message"]


def test_three_days_exactly_and_younger_warnings_are_quiet():
    assert cf.sport_warning_finding("t", "s", WARN, NOW - timedelta(days=3), NOW) is None
    assert cf.sport_warning_finding("t", "s", WARN, NOW - timedelta(hours=5), NOW) is None


def test_errors_clean_runs_and_missing_data_are_not_warnings():
    old = NOW - timedelta(days=9)
    for text in (None, "", "RuntimeError: x answered None", "skipped: robots.txt disallows"):
        assert cf.sport_warning_finding("t", "s", text, old, NOW) is None
    assert cf.sport_warning_finding("t", "s", WARN, None, NOW) is None


def test_collect_checks_every_active_source_and_the_issue_closes_when_the_warning_is_gone(monkeypatch):
    monkeypatch.setattr(cf, "sport_sources", lambda: [("brookings_sd", "internal:sdsu"), ("brookings_sd", "internal:sdsu-club-hockey")])
    rows = {"internal:sdsu": (WARN, NOW - timedelta(days=4)), "internal:sdsu-club-hockey": (None, None)}

    class Conn:
        def execute(self, sql, params):
            self.row = rows.get(params[1])
            return self

        def fetchone(self):
            return self.row

    findings, lines = cf.collect(Conn(), NOW, {"sportwarn"}, NOW.date())
    assert [(f["check"], f["pattern"]) for f in findings] == [("ops.sport-warning", "internal:sdsu")] and len(lines) == 2
    # once the warning is gone the next run reports nothing for it: the existing close rule (two clean runs) then closes the issue
    rows["internal:sdsu"] = (None, None)
    assert cf.collect(Conn(), NOW, {"sportwarn"}, NOW.date())[0] == []
    open_issue = issue_for(findings[0], comments=[CLEAN_MARK])  # the earlier clean run plus this one = two clean runs
    acts = plan_actions([], [open_issue], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c in cf.FRESHNESS_CHECKS)
    assert [a["op"] for a in acts] == ["close"]
    # and a run that checks only the sport freshness leaves the warning issue alone
    assert plan_actions([], [open_issue], clean_to_close=2, scope_towns=ALL_TOWNS_SCOPE, scope_checks=lambda c: c == cf.CHECK_ID["sport"]) == []


def test_the_store_keeps_the_time_of_the_first_identical_warning():
    import inspect
    from sports import store
    sql = inspect.getsource(store.record_health)
    assert "IS NOT DISTINCT FROM EXCLUDED.last_error" in sql and "COALESCE(sport_sources_health.last_error_at, EXCLUDED.last_error_at)" in sql
