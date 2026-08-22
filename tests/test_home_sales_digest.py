"""Regression tests for the FAS 2 home-sales outlier fix (see
ai_pipeline/home_sales_digest.py:compute_stats) -- a sub-$150k sale (family
transfer, partial interest, recording artifact) must never drag the
median/min/max/top-sales figures down, but must still count toward the
total `count` so no sale silently disappears from the record.
"""
from datetime import date

from ai_pipeline.home_sales_digest import OUTLIER_PRICE_FLOOR, compute_stats

MARKET_SALE_A = {"id": 1, "address": "1 Main St", "sale_price": 400_000, "sale_date": date(2026, 6, 1), "raw_data": {}}
MARKET_SALE_B = {"id": 2, "address": "2 Main St", "sale_price": 350_000, "sale_date": date(2026, 6, 2), "raw_data": {}}
OUTLIER_SALE = {"id": 3, "address": "3 Family Transfer Ln", "sale_price": 500, "sale_date": date(2026, 6, 3), "raw_data": {}}


def test_outlier_excluded_from_price_stats():
    stats = compute_stats([MARKET_SALE_A, MARKET_SALE_B, OUTLIER_SALE])
    assert stats["min_price"] == 350_000
    assert stats["max_price"] == 400_000
    assert stats["median_price"] == 375_000


def test_outlier_still_counted_in_total():
    stats = compute_stats([MARKET_SALE_A, MARKET_SALE_B, OUTLIER_SALE])
    assert stats["count"] == 3
    assert stats["outlier_count"] == 1
    assert stats["priced_count"] == 2


def test_top_sales_excludes_outliers():
    stats = compute_stats([MARKET_SALE_A, MARKET_SALE_B, OUTLIER_SALE])
    assert OUTLIER_SALE not in stats["top_sales"]
    assert all(s["sale_price"] >= OUTLIER_PRICE_FLOOR for s in stats["top_sales"])


def test_no_outliers_leaves_stats_unchanged():
    stats = compute_stats([MARKET_SALE_A, MARKET_SALE_B])
    assert stats["outlier_count"] == 0
    assert stats["count"] == 2
