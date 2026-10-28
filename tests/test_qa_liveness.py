"""scripts/check_qa_liveness.py -- the pure parts (response parsing, threshold)."""
from datetime import datetime, timedelta, timezone

from scripts.check_qa_liveness import MAX_HOURS, is_stale, latest_success

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_limit_is_30_hours():
    assert MAX_HOURS == 30


def test_no_green_run_is_stale():
    assert is_stale(latest_success({"workflow_runs": []}), NOW)
    assert is_stale(None, NOW)


def test_only_successful_runs_count_and_the_newest_wins():
    payload = {"workflow_runs": [
        {"conclusion": "failure", "updated_at": "2026-10-28T07:00:00Z"},
        {"conclusion": "success", "updated_at": "2026-10-26T07:05:00Z"},
        {"conclusion": "success", "updated_at": "2026-10-27T07:10:00Z"},
    ]}
    assert latest_success(payload) == datetime(2026, 10, 27, 7, 10, tzinfo=timezone.utc)


def test_threshold_edges():
    assert not is_stale(NOW - timedelta(hours=MAX_HOURS), NOW)
    assert is_stale(NOW - timedelta(hours=MAX_HOURS, minutes=1), NOW)
    assert not is_stale(NOW - timedelta(hours=5), NOW)
