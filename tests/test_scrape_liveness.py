"""scripts/check_scrape_liveness.py -- pure threshold logic only; the DB query
follows this codebase's convention of no dedicated test for DB-bound code
(see tests/test_staleness.py's docstring)."""
from datetime import datetime, timedelta, timezone

from scripts.check_scrape_liveness import MAX_HOURS, is_stale

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def test_never_succeeded_is_stale():
    assert is_stale(None, NOW)


def test_recent_success_is_fresh():
    assert not is_stale(NOW - timedelta(hours=6), NOW)


def test_exactly_at_limit_is_fresh_just_over_is_stale():
    assert not is_stale(NOW - timedelta(hours=MAX_HOURS), NOW)
    assert is_stale(NOW - timedelta(hours=MAX_HOURS, minutes=1), NOW)


def test_limit_is_18_hours():
    assert MAX_HOURS == 18


def test_custom_limit():
    assert is_stale(NOW - timedelta(hours=3), NOW, max_hours=2)
