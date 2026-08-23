"""Regression tests for scrapers/parsers/usda.py -- see NEEDS-HUMAN-REVIEW.md
"Brookings — Farm Report Depth". _monthly_rows() is the fix: parse() used to
keep only the single latest row per commodity (max()), discarding the
history the API call already fetched, which made direction/trend
impossible even though the data was right there. No DB, no network."""
from scrapers.parsers.usda import DISPLAY_ORDER, NATIONAL_SERIES, STATE_SERIES, _monthly_rows

JAN_2026 = {"year": 2026, "reference_period_desc": "JAN", "Value": "3.94"}
FEB_2026 = {"year": 2026, "reference_period_desc": "FEB", "Value": "4.01"}
MAR_2026 = {"year": 2026, "reference_period_desc": "MAR", "Value": "3.88"}
MARKETING_YEAR_2025 = {"year": 2025, "reference_period_desc": "MARKETING YEAR", "Value": "20.8"}


def test_monthly_rows_drops_marketing_year():
    result = _monthly_rows([JAN_2026, MARKETING_YEAR_2025])
    assert result == [JAN_2026]


def test_monthly_rows_keeps_multiple_real_months():
    result = _monthly_rows([JAN_2026, FEB_2026, MAR_2026])
    assert len(result) == 3


def test_monthly_rows_sorted_chronologically():
    result = _monthly_rows([MAR_2026, JAN_2026, FEB_2026])
    assert [r["reference_period_desc"] for r in result] == ["JAN", "FEB", "MAR"]


def test_monthly_rows_caps_at_history_months():
    rows = [{"year": 2025, "reference_period_desc": m, "Value": "1"}
            for m in ("JAN", "FEB", "MAR", "APR", "MAY", "JUN")]
    result = _monthly_rows(rows, history_months=3)
    assert len(result) == 3
    assert [r["reference_period_desc"] for r in result] == ["APR", "MAY", "JUN"]


def test_monthly_rows_dedupes_same_period():
    stale = {"year": 2026, "reference_period_desc": "JAN", "Value": "3.50"}
    revised = {"year": 2026, "reference_period_desc": "JAN", "Value": "3.94"}
    result = _monthly_rows([stale, revised])
    assert len(result) == 1
    assert result[0]["Value"] == "3.94"  # keeps the later-seen row


def test_monthly_rows_empty_input():
    assert _monthly_rows([]) == []


def test_display_order_matches_state_plus_national():
    assert set(DISPLAY_ORDER) == set(STATE_SERIES) | set(NATIONAL_SERIES)
    assert set(STATE_SERIES) & set(NATIONAL_SERIES) == set()


def test_national_series_is_cattle_and_hogs():
    assert set(NATIONAL_SERIES) == {"cattle", "hogs"}
