"""Tests for ai_pipeline/home_sales_digest.py (Handoff: Information Hub
Tier 1, Feature C -- Housing Market).

Covers: the FAS 2 outlier fix (compute_stats), small-sample suppression
(§4.2 -- "a median of four sales is noise presented as insight"), MoM/YoY
comparison gating (§4.2 -- "only when a real prior-year figure exists, no
extrapolation"), and the check_no_financial_advice guardrail (§4.2).
"""
import statistics
from datetime import date

from ai_pipeline.guardrails import check_no_financial_advice, validate
from ai_pipeline.home_sales_digest import (
    OUTLIER_PRICE_FLOOR, SMALL_SAMPLE_THRESHOLD, compute_stats, source_text, template_fallback,
)


def _sale(id_, price, day=1):
    return {"id": id_, "address": f"{id_} Main St", "sale_price": price, "sale_date": date(2026, 6, day), "raw_data": {}}


# --- outlier exclusion (padded above SMALL_SAMPLE_THRESHOLD so these aren't
# confounded by the small-sample suppression tested separately below) -------

FILLER_SALES = [_sale(100 + i, 320_000) for i in range(SMALL_SAMPLE_THRESHOLD - 2)]
MARKET_SALE_A = _sale(1, 400_000)
MARKET_SALE_B = _sale(2, 350_000)
OUTLIER_SALE = _sale(3, 500)
MARKET_PRICES = sorted(s["sale_price"] for s in FILLER_SALES + [MARKET_SALE_A, MARKET_SALE_B])
FULL_SAMPLE = FILLER_SALES + [MARKET_SALE_A, MARKET_SALE_B, OUTLIER_SALE]


def test_outlier_excluded_from_price_stats():
    stats = compute_stats(FULL_SAMPLE)
    assert stats["min_price"] == min(MARKET_PRICES)
    assert stats["max_price"] == max(MARKET_PRICES)
    assert stats["median_price"] == statistics.median(MARKET_PRICES)


def test_outlier_still_counted_in_total():
    stats = compute_stats(FULL_SAMPLE)
    assert stats["count"] == len(FULL_SAMPLE)
    assert stats["outlier_count"] == 1
    assert stats["priced_count"] == len(MARKET_PRICES)


def test_top_sales_excludes_outliers():
    stats = compute_stats(FULL_SAMPLE)
    assert OUTLIER_SALE not in stats["top_sales"]
    assert all(s["sale_price"] >= OUTLIER_PRICE_FLOOR for s in stats["top_sales"])


def test_no_outliers_leaves_stats_unchanged():
    stats = compute_stats(FILLER_SALES + [MARKET_SALE_A, MARKET_SALE_B])
    assert stats["outlier_count"] == 0
    assert stats["count"] == len(FILLER_SALES) + 2


# --- small-sample suppression -----------------------------------------------

def test_small_sample_suppresses_median_but_keeps_the_real_count():
    small = [_sale(i, 300_000 + i * 1000) for i in range(5)]
    stats = compute_stats(small)
    assert stats["small_sample"] is True
    assert stats["median_price"] is None
    assert stats["min_price"] is None
    assert stats["max_price"] is None
    assert stats["count"] == 5
    assert stats["priced_count"] == 5


def test_sample_exactly_at_threshold_is_not_suppressed():
    at_threshold = [_sale(i, 300_000) for i in range(SMALL_SAMPLE_THRESHOLD)]
    stats = compute_stats(at_threshold)
    assert stats["small_sample"] is False
    assert stats["median_price"] == 300_000


def test_source_text_carries_a_sample_size_note_instead_of_a_median():
    small = [_sale(i, 300_000) for i in range(3)]
    stats = compute_stats(small)
    text = source_text(stats, "June 2026")
    assert "SAMPLE SIZE NOTE" in text
    assert "MEDIAN SALE PRICE" not in text
    assert "TOTAL RECORDED SALES: 3" in text


def test_template_fallback_reports_count_only_for_a_small_sample():
    small = [_sale(i, 300_000) for i in range(3)]
    stats = compute_stats(small)
    text = template_fallback(stats, "June 2026", {"display_name": "Moreno Valley"})
    # No STATED median figure (e.g. "The median recorded sale price was
    # $300,000") -- the word "median" legitimately still appears once, in
    # the sentence explaining why one isn't being reported.
    assert "median recorded sale price was" not in text.lower()
    assert "too small a sample to report a median" in text.lower()
    assert "3 home sale" in text


# --- MoM / YoY comparison, real data only -----------------------------------

def _flat_month(offset, price):
    return [_sale(offset + i, price) for i in range(SMALL_SAMPLE_THRESHOLD)]


def test_source_text_includes_comparisons_when_both_prior_periods_have_real_data():
    current = compute_stats(_flat_month(0, 400_000))
    prior_month = compute_stats(_flat_month(1000, 350_000))
    prior_year = compute_stats(_flat_month(2000, 320_000))
    text = source_text(current, "June 2026", mom_stats=prior_month, mom_label="May 2026",
                        yoy_stats=prior_year, yoy_label="June 2025")
    assert "VS LAST MONTH (May 2026)" in text
    assert "VS SAME MONTH LAST YEAR (June 2025)" in text


def test_source_text_omits_comparison_when_prior_month_has_no_data_at_all():
    current = compute_stats(_flat_month(0, 400_000))
    empty_prior = compute_stats([])  # no rows that month -- not extrapolated
    text = source_text(current, "June 2026", mom_stats=empty_prior, mom_label="May 2026")
    assert "VS LAST MONTH" not in text


def test_source_text_omits_comparison_when_prior_month_is_itself_small_sample():
    current = compute_stats(_flat_month(0, 400_000))
    small_prior = compute_stats([_sale(9000 + i, 300_000) for i in range(3)])
    text = source_text(current, "June 2026", mom_stats=small_prior, mom_label="May 2026")
    assert "VS LAST MONTH" not in text


def test_template_fallback_states_the_real_percentage_change():
    current = compute_stats(_flat_month(0, 440_000))
    prior_month = compute_stats(_flat_month(1000, 400_000))
    text = template_fallback(current, "June 2026", {"display_name": "Moreno Valley"},
                              mom_stats=prior_month, mom_label="May 2026")
    assert "+10.0%" in text


# --- check_no_financial_advice ----------------------------------------------

ADVICE_EXAMPLES = [
    "This looks like a good time to buy in this ZIP code.",
    "Sellers should list their homes now while prices are high.",
    "The market is heating up, so buyers should act fast.",
    "You'll want to invest in this neighborhood before prices climb further.",
    "It's a smart investment given the recent trend.",
    "If you're considering buying, now is the time.",
]

SAFE_EXAMPLES = [
    "The median recorded sale price was $410,000, up 3.2% from last month.",
    "Riverside County recorded 42 home sales in Moreno Valley for June 2026.",
    "Activity concentrated in the 92553 ZIP code, with 12 recorded sales.",
    "The highest recorded sale was 15230 Sunnymead Blvd at $610,000.",
    "Data is from Riverside County's public assessor report, updated quarterly.",
]


def test_check_no_financial_advice_rejects_recommendations():
    for text in ADVICE_EXAMPLES:
        result = check_no_financial_advice(text)
        assert not result.passed, f"expected rejection: {text!r}"


def test_check_no_financial_advice_allows_factual_reporting():
    for text in SAFE_EXAMPLES:
        result = check_no_financial_advice(text)
        assert result.passed, f"expected pass: {text!r} (violations: {result.violations})"


# --- numeral verification (shared guardrails.validate(), see its own tests --
# this pins the behavior specifically for home-sales-shaped content, per
# Handoff §6's explicit ask: "assert a fabricated number is caught") --------

def test_a_fabricated_number_is_caught_by_the_shared_fact_checker():
    src = (
        "MONTH: June 2026\n"
        "SOURCE: Riverside County Assessor's Property Sales Report\n"
        "TOTAL RECORDED SALES: 42\n"
        "MEDIAN SALE PRICE: $410,000"
    )
    fabricated = "The median recorded sale price was $999,000 across 42 sales this month."
    result = validate(fabricated, src, {"display_name": "Moreno Valley", "state": "CA"})
    assert not result.passed
    assert any("999" in v for v in result.violations)


def test_a_real_number_from_the_source_passes():
    src = (
        "MONTH: June 2026\n"
        "SOURCE: Riverside County Assessor's Property Sales Report\n"
        "TOTAL RECORDED SALES: 42\n"
        "MEDIAN SALE PRICE: $410,000"
    )
    honest = "Riverside County recorded 42 home sales this month, with a median price of $410,000."
    result = validate(honest, src, {"display_name": "Moreno Valley", "state": "CA"})
    assert result.passed
