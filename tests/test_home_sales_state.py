"""Regression tests for the three-state home-sales month classification (see
ai_pipeline/home_sales_state.py's module docstring for the Sept 2025 case
this was built to fix -- an interior gap between two populated months that
the old "strictly after the latest month" heuristic couldn't distinguish
from "county hasn't published yet").
"""
from datetime import date

from ai_pipeline.home_sales_state import MonthState, resolve_state


def test_any_sales_means_released_with_data():
    # Even a stale/irrelevant window_end doesn't matter once there's data.
    assert resolve_state(5, 2025, 9, None) == MonthState.RELEASED_WITH_DATA
    assert resolve_state(1, 2025, 9, date(2020, 1, 1)) == MonthState.RELEASED_WITH_DATA


def test_no_ingest_metadata_is_conservatively_not_yet_released():
    """Before scripts/reconcile_property_sales.py has ever run, we have no
    basis to claim a zero-row month is genuinely empty."""
    assert resolve_state(0, 2025, 9, None) == MonthState.NOT_YET_RELEASED


def test_window_covering_the_month_means_genuinely_zero():
    """The Sept 2025 case: countywide RecordDate window reaches well past
    the month's end, and Moreno Valley has zero qualifying rows for it --
    that's a real reporting fact, not a gap."""
    window_end = date(2025, 12, 24)
    assert resolve_state(0, 2025, 9, window_end) == MonthState.RELEASED_ZERO


def test_window_ending_exactly_on_last_day_of_month_counts_as_covered():
    window_end = date(2025, 9, 30)
    assert resolve_state(0, 2025, 9, window_end) == MonthState.RELEASED_ZERO


def test_window_short_of_the_month_means_not_yet_released():
    window_end = date(2025, 8, 15)
    assert resolve_state(0, 2025, 9, window_end) == MonthState.NOT_YET_RELEASED


def test_december_month_end_rolls_into_next_year_correctly():
    # month_bounds() has to correctly step from December into January --
    # regression guard for the ordinal arithmetic in resolve_state().
    assert resolve_state(0, 2025, 12, date(2025, 12, 31)) == MonthState.RELEASED_ZERO
    assert resolve_state(0, 2025, 12, date(2025, 12, 30)) == MonthState.NOT_YET_RELEASED
