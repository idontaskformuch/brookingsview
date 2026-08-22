"""Regression tests for the FAS 2 events fixes (see ai_pipeline/publish.py):
- has_substance() extended to gate thin events (title-only, no description,
  no venue+time) the same way meetings were already gated.
- group_recurring_events() collapses a program repeated 3+ times into one
  canonical series instead of one near-duplicate page per occurrence.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ai_pipeline.publish import group_recurring_events, has_substance

UTC = timezone.utc
PACIFIC = ZoneInfo("America/Los_Angeles")


def test_event_with_description_has_substance():
    row = {"raw_data": {"description": "Bring your own mat for this all-ages yoga session."}}
    assert has_substance("events", row) is True


def test_event_with_venue_and_time_but_no_description_has_substance():
    row = {"raw_data": {}, "venue": "Main Library", "starts_at": datetime(2026, 9, 1, tzinfo=UTC)}
    assert has_substance("events", row) is True


def test_bare_title_only_event_is_thin():
    row = {"raw_data": {}, "venue": None, "starts_at": None}
    assert has_substance("events", row) is False


def test_recurring_series_row_skips_the_events_check():
    # a canonical series row (built by group_recurring_events) never has its
    # own venue/starts_at/description in the same shape -- has_substance
    # must not thin-gate it a second time
    row = {"is_recurring_series": True, "raw_data": {}}
    assert has_substance("events", row) is True


def test_below_threshold_occurrences_pass_through_ungrouped():
    rows = [
        {"id": 1, "title": "One-off Book Sale", "source": "library", "starts_at": datetime(2026, 9, 1, tzinfo=UTC)},
        {"id": 2, "title": "One-off Book Sale", "source": "library", "starts_at": datetime(2026, 9, 8, tzinfo=UTC)},
    ]
    result = group_recurring_events(rows, PACIFIC)
    assert len(result) == 2
    assert all(not r.get("is_recurring_series") for r in result)


def test_at_threshold_occurrences_collapse_to_one_series():
    rows = [
        {"id": i, "title": "Toddler Time", "source": "library", "starts_at": datetime(2026, 9, 1 + i * 7, tzinfo=UTC)}
        for i in range(3)
    ]
    result = group_recurring_events(rows, PACIFIC)
    assert len(result) == 1
    assert result[0]["is_recurring_series"] is True
    assert result[0]["series_count"] == 3


def test_different_sources_never_collapse_together():
    rows = [
        {"id": 1, "title": "Story Time", "source": "library", "starts_at": datetime(2026, 9, 1, tzinfo=UTC)},
        {"id": 2, "title": "Story Time", "source": "city_calendar", "starts_at": datetime(2026, 9, 8, tzinfo=UTC)},
        {"id": 3, "title": "Story Time", "source": "city_calendar", "starts_at": datetime(2026, 9, 15, tzinfo=UTC)},
        {"id": 4, "title": "Story Time", "source": "city_calendar", "starts_at": datetime(2026, 9, 22, tzinfo=UTC)},
    ]
    result = group_recurring_events(rows, PACIFIC)
    # the lone library instance stays separate; the 3 city_calendar instances collapse
    assert len(result) == 2
    series = [r for r in result if r.get("is_recurring_series")]
    assert len(series) == 1
    assert series[0]["series_count"] == 3


def test_series_slug_is_stable_across_runs():
    rows = [
        {"id": i, "title": "Free Food Giveaway", "source": "county", "starts_at": datetime(2026, 9, 1 + i, tzinfo=UTC)}
        for i in range(3)
    ]
    first = group_recurring_events(rows, PACIFIC)[0]["id"]
    second = group_recurring_events(rows, PACIFIC)[0]["id"]
    assert first == second
    assert first.startswith("series-")
