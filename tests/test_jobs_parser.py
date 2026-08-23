"""Regression tests for the FAS 2 jobs_v1.py sanitization (see
scrapers/parsers/jobs_v1.py:_classify_category/_sanitize_salary) --
Adzuna's own category regularly landed listings under a generic bucket, and
salary_min=0 rows read as "the job pays nothing" instead of "no floor was
given". Both are corrected at parse time, before the row is written.
"""
from scrapers.parsers.jobs_v1 import _classify_category, _sanitize_salary


def test_classify_prefers_keyword_match_over_generic_adzuna_label():
    assert _classify_category("Warehouse Associate - Night Shift", "Other/General Jobs") == "Warehouse & Logistics"


def test_classify_falls_back_to_specific_adzuna_label():
    assert _classify_category("Regional Account Executive", "Sales Jobs") == "Sales Jobs"


def test_classify_returns_none_for_generic_label_and_no_keyword_match():
    assert _classify_category("Regional Account Executive", "Other/General Jobs") is None


def test_classify_returns_none_when_nothing_available():
    assert _classify_category("Regional Account Executive", None) is None


def test_classify_does_not_substring_match_inside_a_longer_word():
    # caught live against real data: "reconstruction" contains "construction"
    # as a substring but is not a construction-trades job -- must use word
    # boundaries, not naive substring containment.
    assert _classify_category(
        "Advanced Head & Neck Oncologic Surgery and Microvascular "
        "Reconstruction Fellowship", "Healthcare & Nursing Jobs",
    ) == "Healthcare & Nursing Jobs"


def test_classify_short_keyword_rn_only_matches_whole_word():
    assert _classify_category("RN - Flex - Full Time Days", None) == "Healthcare & Nursing"
    assert _classify_category("Barn Renovation Specialist", None) is None


def test_sanitize_zero_floor_becomes_none_not_zero():
    lo, hi = _sanitize_salary(0, 45_000)
    assert lo is None
    assert hi == 45_000


def test_sanitize_normal_range_untouched():
    lo, hi = _sanitize_salary(40_000, 60_000)
    assert (lo, hi) == (40_000, 60_000)


def test_sanitize_absurd_ratio_drops_both():
    lo, hi = _sanitize_salary(10, 200_000)
    assert (lo, hi) == (None, None)


def test_sanitize_both_none_stays_none():
    assert _sanitize_salary(None, None) == (None, None)


def test_sanitize_implausibly_low_flat_salary_dropped():
    # Real observed row: "General Manager" at a Domino's franchise,
    # salary_min=salary_max=16208.31 (almost certainly a misparsed hourly
    # rate stamped as an annual salary) -- ratio=1, so the old ratio-only
    # check never caught it.
    assert _sanitize_salary(16_208.31, 16_208.31) == (None, None)


def test_sanitize_implausibly_high_flat_salary_dropped():
    # Real observed row: "Licensed Psychiatrist" at Headway,
    # salary_min=salary_max=494811 -- identical across 3 different job
    # titles at the same employer, pointing to a category-average value,
    # not a real per-listing figure.
    assert _sanitize_salary(494_811, 494_811) == (None, None)


def test_sanitize_plausible_flat_salary_kept():
    assert _sanitize_salary(65_000, 65_000) == (65_000, 65_000)


def test_sanitize_one_sided_implausible_value_drops_both():
    # A wide-looking range where only the top end is implausible should
    # still be sanitized away, not silently truncated to just the min.
    assert _sanitize_salary(40_000, 500_000) == (None, None)
