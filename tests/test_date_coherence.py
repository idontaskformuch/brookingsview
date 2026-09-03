"""Regression tests for validation/date_coherence.py (Phase 0 check 3)."""
from datetime import datetime
from zoneinfo import ZoneInfo

from validation.date_coherence import check_date_coherence

CFG = {"timezone": "America/Chicago"}
TZ = ZoneInfo("America/Chicago")

# Wednesday 2026-09-02 (day before, for "tomorrow" cases) / Thursday 2026-09-03.
WEDNESDAY = datetime(2026, 9, 2, 9, 0, tzinfo=TZ)
THURSDAY = datetime(2026, 9, 3, 9, 0, tzinfo=TZ)
FRIDAY = datetime(2026, 9, 4, 9, 0, tzinfo=TZ)


def test_passes_with_no_relative_day_word():
    result = check_date_coherence("City Council approved the budget.", THURSDAY, CFG, reference_now=THURSDAY)
    assert result.passed


def test_today_matches_when_record_date_is_today():
    text = "The council meets today to discuss the budget."
    result = check_date_coherence(text, THURSDAY, CFG, reference_now=THURSDAY)
    assert result.passed


def test_today_fails_when_record_date_is_not_today():
    text = "The council meets today to discuss the budget."
    result = check_date_coherence(text, FRIDAY, CFG, reference_now=THURSDAY)
    assert not result.passed
    assert any("today" in v for v in result.violations)


def test_tonight_is_treated_the_same_as_today():
    text = "The library hosts a reading tonight at seven."
    result = check_date_coherence(text, FRIDAY, CFG, reference_now=THURSDAY)
    assert not result.passed


def test_tomorrow_matches_when_record_date_is_the_next_day():
    text = "The meeting is scheduled for tomorrow."
    result = check_date_coherence(text, FRIDAY, CFG, reference_now=THURSDAY)
    assert result.passed


def test_tomorrow_fails_when_record_date_is_today():
    text = "The meeting is scheduled for tomorrow."
    result = check_date_coherence(text, THURSDAY, CFG, reference_now=THURSDAY)
    assert not result.passed


def test_this_weekend_matches_the_coming_saturday():
    saturday = datetime(2026, 9, 5, 9, 0, tzinfo=TZ)
    text = "The festival runs this weekend at the fairgrounds."
    result = check_date_coherence(text, saturday, CFG, reference_now=THURSDAY)
    assert result.passed


def test_this_weekend_fails_when_record_date_is_a_weekday():
    text = "The festival runs this weekend at the fairgrounds."
    result = check_date_coherence(text, FRIDAY, CFG, reference_now=THURSDAY)
    assert not result.passed


def test_correct_weekday_name_passes():
    # 2026-09-03 is a Thursday.
    text = "The council meets Thursday night to vote on the ordinance."
    result = check_date_coherence(text, THURSDAY, CFG, reference_now=THURSDAY)
    assert result.passed


def test_wrong_weekday_name_fails():
    text = "The council meets Monday night to vote on the ordinance."
    result = check_date_coherence(text, THURSDAY, CFG, reference_now=THURSDAY)
    assert not result.passed
    assert any("Monday" in v and "Thursday" in v for v in result.violations)


def test_only_checks_the_lede_not_the_whole_body():
    # A later paragraph referencing a different day is normal ("last met on
    # Monday") -- only the opening headline/lede claim must match.
    text = ("The council meets Thursday night to vote on the ordinance.\n\n"
            "The committee last discussed this on Monday, records show.")
    result = check_date_coherence(text, THURSDAY, CFG, reference_now=THURSDAY)
    assert result.passed


def test_no_record_date_means_nothing_to_check():
    text = "The council meets today to discuss the budget."
    result = check_date_coherence(text, None, CFG, reference_now=THURSDAY)
    assert result.passed


def test_timezone_matters_at_the_day_boundary():
    # 2026-09-03 23:30 America/Chicago is still 2026-09-04 in UTC -- the
    # record's date must be read in the TOWN's own timezone, not UTC/naive.
    late_chicago = datetime(2026, 9, 3, 23, 30, tzinfo=TZ)
    text = "The council meets today to discuss the budget."
    result = check_date_coherence(text, late_chicago, CFG, reference_now=THURSDAY)
    assert result.passed
