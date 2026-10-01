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


def test_default_thresholds_match_the_handoff_examples():
    # "meetings 7 days, events 2 days" -- the Broomfield handoff's own examples.
    assert DEFAULT_STALENESS_DAYS["city_meetings"] == 7
    assert DEFAULT_STALENESS_DAYS["events"] == 2


def test_source_tables_only_covers_verified_mappings():
    # Deliberately not exhaustive -- every entry must have both a default
    # threshold and a real (table, column) pair, nothing silently guessed.
    for source_key, (table, column) in SOURCE_TABLES.items():
        assert source_key in DEFAULT_STALENESS_DAYS, f"{source_key} has a table mapping but no default threshold"
        assert table and column
