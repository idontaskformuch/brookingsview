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


# --- a series is shown by its NEXT occurrence, not the first row ever stored (Glasgow 2026-10-24) ---------------------------
from ai_pipeline.publish import _refresh_series_occurs_at  # noqa: E402

LONDON = ZoneInfo("Europe/London")


def _weekly(first_day, n):
    return [
        {"id": i + 1, "title": "Honey Bees Knitting group", "source": "glasgow_life",
         "starts_at": datetime(2026, 10, first_day + 7 * i, tzinfo=UTC), "raw_data": {}}
        for i in range(n)
    ]


def test_series_starts_at_the_next_upcoming_occurrence_and_lists_only_upcoming_dates():
    rows = _weekly(2, 5)  # 2, 9, 16, 23, 30 Oct
    [series] = group_recurring_events(rows, LONDON, now=datetime(2026, 10, 24, 6, 0, tzinfo=UTC))
    assert series["starts_at"] == datetime(2026, 10, 30, tzinfo=UTC)
    assert series["series_has_upcoming"] is True
    assert series["series_count"] == 1 and len(series["series_dates"]) == 1 and "Oct 30" in series["series_dates"][0]


def test_an_occurrence_on_todays_local_date_still_counts_as_upcoming():
    rows = _weekly(2, 5)
    [series] = group_recurring_events(rows, LONDON, now=datetime(2026, 10, 23, 23, 30, tzinfo=UTC))  # 00:30 BST on the 24th: the 23rd is over
    assert series["starts_at"] == datetime(2026, 10, 30, tzinfo=UTC)
    [series] = group_recurring_events(rows, LONDON, now=datetime(2026, 10, 23, 10, 0, tzinfo=UTC))
    assert series["starts_at"] == datetime(2026, 10, 23, tzinfo=UTC) and series["series_count"] == 2


def test_a_fully_past_series_keeps_the_old_behaviour_and_is_flagged():
    rows = _weekly(2, 3)
    [series] = group_recurring_events(rows, LONDON, now=datetime(2026, 12, 1, tzinfo=UTC))
    assert series["starts_at"] == datetime(2026, 10, 2, tzinfo=UTC)
    assert series["series_has_upcoming"] is False and series["series_count"] == 3


class _Cur:
    def __init__(self, log): self.log, self.rowcount = log, 1
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params): self.log.append((sql, params))


class _Conn:
    def __init__(self): self.log = []
    def cursor(self): return _Cur(self.log)


def test_refresh_moves_only_a_flagged_series_story_and_only_when_the_date_differs():
    conn = _Conn()
    nxt = datetime(2026, 10, 30, tzinfo=UTC)
    assert _refresh_series_occurs_at(conn, "glasgow", "event-series-abc", nxt) == 1
    sql, params = conn.log[0]
    assert "is_recurring_series" in sql and "IS DISTINCT FROM" in sql and sql.lstrip().startswith("UPDATE stories")
    assert params == (nxt, "glasgow", "event-series-abc", nxt)
    assert _refresh_series_occurs_at(conn, "glasgow", "event-series-abc", None) == 0 and len(conn.log) == 1
