"""Regression tests for scrapers/staleness.py's pure logic. The DB-touching
parts (check_source_staleness's query, check_all_sources, report_and_alert)
follow this codebase's established convention of no dedicated test file for
DB-dependent code (see e.g. lib/db.ts's own equivalent note) -- verified
instead against real data (see the commit this module was added in: Moreno
Valley's actual eSCRIBE meetings gap, confirmed live).
"""
from datetime import datetime, timedelta, timezone

from scrapers.staleness import (
    DEFAULT_STALENESS_DAYS, SOURCE_TABLES, StalenessResult, check_source_staleness,
)


def test_unknown_source_key_returns_none_without_touching_the_db():
    # spec lookup fails before conn is ever used -- conn=None must be safe.
    assert check_source_staleness(None, "brookings_sd", "weather", {}) is None


def test_age_days_none_when_no_rows_exist():
    result = StalenessResult("brookings_sd", "city_meetings", "meetings", None, 7, is_stale=True)
    assert result.age_days is None


def test_age_days_computed_from_aware_datetime():
    newest = datetime.now(timezone.utc) - timedelta(days=3)
    result = StalenessResult("brookings_sd", "city_meetings", "meetings", newest, 7, is_stale=False)
    assert 2.9 < result.age_days < 3.1


def test_age_days_handles_naive_datetime_as_utc():
    # Postgres can return a naive datetime for some column types -- must not crash.
    newest = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=5)
    result = StalenessResult("brookings_sd", "city_meetings", "meetings", newest, 7, is_stale=False)
    assert 4.9 < result.age_days < 5.1


def test_default_thresholds_are_the_owner_chosen_values():
    # Owner decision 2026-10-28 (was 7 / 2 from the Broomfield handoff): a quiet source is not a broken one.
    assert DEFAULT_STALENESS_DAYS["city_meetings"] == 21
    assert DEFAULT_STALENESS_DAYS["events"] == 7


def test_source_tables_only_covers_verified_mappings():
    # Deliberately not exhaustive -- every entry must have both a default
    # threshold and a real (table, column) pair, nothing silently guessed.
    for source_key, (table, column) in SOURCE_TABLES.items():
        assert source_key in DEFAULT_STALENESS_DAYS, f"{source_key} has a table mapping but no default threshold"
        assert table and column


# --- paused sources (owner 2026-11-24) -----------------------------------------------------------------------------------------------
# Real names from configs/moreno_valley_ca.json data_sources.events: city_events and library (Tockify, paused since 2026-11-13) and
# farm_house_collective (active).
import json
from pathlib import Path

from scrapers.staleness import all_sources_paused, check_all_sources, paused_names

PAUSED = {"since": "2026-11-13", "reason": "waiting for permission"}


class _Cur:
    def __init__(self, log, newest):
        self.log, self.newest = log, newest

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params):
        self.log.append((sql, params))

    def fetchone(self):
        return (self.newest,)


class _Conn:
    def __init__(self, newest):
        self.log, self.newest = [], newest

    def cursor(self):
        return _Cur(self.log, self.newest)


def _moreno_events_cfg():
    cfg = json.loads((Path(__file__).resolve().parent.parent / "configs" / "moreno_valley_ca.json").read_text(encoding="utf-8"))
    return cfg["data_sources"]["events"]


def test_moreno_tockify_sources_are_paused_in_config_and_the_others_are_not():
    assert paused_names(_moreno_events_cfg()) == ["city_events", "library"]
    assert not all_sources_paused(_moreno_events_cfg())


def test_paused_sources_are_left_out_of_the_freshness_query():
    conn = _Conn(datetime.now(timezone.utc) - timedelta(days=10))
    res = check_source_staleness(conn, "moreno_valley_ca", "events", _moreno_events_cfg())
    sql, params = conn.log[0]
    assert "source <> ALL" in sql and params == ("moreno_valley_ca", ["city_events", "library"])
    # farm_house_collective is the only active source and posts rarely: the Moreno events block has staleness_days 21 (owner 2026-11-24)
    assert res.threshold_days == 21 and not res.is_stale
    stale = check_source_staleness(_Conn(datetime.now(timezone.utc) - timedelta(days=25)), "moreno_valley_ca", "events", _moreno_events_cfg())
    assert stale.is_stale


def test_a_block_with_every_source_paused_is_not_checked_and_never_stale():
    cfg = {"enabled": True, "sources": [{"name": "city_events", "paused": PAUSED}, {"name": "library", "paused": PAUSED}]}
    assert check_source_staleness(None, "moreno_valley_ca", "events", cfg) is None  # conn=None: no query is made
    assert check_all_sources(None, {"town_id": "moreno_valley_ca", "data_sources": {"events": cfg}}) == []


def test_unpaused_block_queries_the_whole_town_as_before():
    conn = _Conn(datetime.now(timezone.utc) - timedelta(days=1))
    res = check_source_staleness(conn, "brookings_sd", "events", {"sources": [{"name": "library"}]})
    assert "source <>" not in conn.log[0][0] and not res.is_stale
