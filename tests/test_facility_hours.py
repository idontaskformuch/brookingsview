"""Regression tests for ai_pipeline/facility_hours.py.

The parseable-vs-flagged fixtures below are the ACTUAL hours_text values
seeded for real facilities across all three towns, confirmed live against
the database 2026-09-04 -- not synthetic strings written to make the parser
look good. 10 of 12 real rows parse cleanly; 2 are genuinely ambiguous and
must be flagged, not guessed.
"""
from ai_pipeline.facility_hours import parse_hours_text


def test_none_and_empty_are_not_flagged_just_have_no_data():
    for raw in (None, "", "   "):
        result = parse_hours_text(raw)
        assert result.structured is None
        assert result.needs_review is False


# --- real data: rows that parse cleanly -------------------------------------

def test_brookings_city_hall_day_range_plus_single_day_with_noon():
    result = parse_hours_text("Mon–Thu 7am–5pm, Fri 7am–noon")
    assert result.needs_review is False
    assert result.structured["monday"] == ("07:00", "17:00")
    assert result.structured["thursday"] == ("07:00", "17:00")
    assert result.structured["friday"] == ("07:00", "12:00")
    # Never mentioned -> closed, the standard posted-hours convention.
    assert result.structured["saturday"] is None
    assert result.structured["sunday"] is None


def test_daily_expands_to_all_seven_days():
    result = parse_hours_text("Daily 6am–11pm")
    assert result.needs_review is False
    for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        assert result.structured[day] == ("06:00", "23:00")


def test_brookings_public_library_three_groups():
    result = parse_hours_text("Mon–Thu 9:30am–9pm, Fri–Sat 9:30am–5:30pm, Sun 1pm–5pm")
    assert result.needs_review is False
    assert result.structured["monday"] == ("09:30", "21:00")
    assert result.structured["friday"] == ("09:30", "17:30")
    assert result.structured["saturday"] == ("09:30", "17:30")
    assert result.structured["sunday"] == ("13:00", "17:00")


def test_broomfield_community_center_ascii_hyphen_not_en_dash():
    result = parse_hours_text("Mon-Thu 5am-10pm, Fri 5am-8pm, Sat 7am-8pm, Sun 8am-6pm")
    assert result.needs_review is False
    assert result.structured["friday"] == ("05:00", "20:00")
    assert result.structured["sunday"] == ("08:00", "18:00")


def test_broomfield_library_ascii_hyphen():
    result = parse_hours_text("Mon-Thu 9am-9pm, Fri-Sat 9am-5pm, Sun 1pm-5pm")
    assert result.needs_review is False
    assert result.structured["saturday"] == ("09:00", "17:00")


def test_paul_derda_rec_center_with_half_hour_minutes():
    result = parse_hours_text("Mon-Thu 5am-10pm, Fri 5am-6:30pm, Sat 7am-8pm, Sun 8am-6pm")
    assert result.needs_review is False
    assert result.structured["friday"] == ("05:00", "18:30")


def test_moreno_valley_main_library_noon_as_start_time():
    result = parse_hours_text("Mon–Thu 9am–8pm, Fri 9am–6pm, Sat 9am–5pm, Sun noon–5pm")
    assert result.needs_review is False
    assert result.structured["sunday"] == ("12:00", "17:00")


def test_lasselle_sports_park_daily_en_dash():
    result = parse_hours_text("Daily 6am–10pm")
    assert result.needs_review is False
    assert result.structured["wednesday"] == ("06:00", "22:00")


def test_iris_plaza_and_mall_branch_library_closed_day_keyword():
    # "closed Sunday" -- the day comes AFTER "closed", a different shape
    # from every other group in this dataset.
    result = parse_hours_text("Mon–Fri 10am–8pm, Sat 10am–6pm, closed Sunday")
    assert result.needs_review is False
    assert result.structured["saturday"] == ("10:00", "18:00")
    assert result.structured["sunday"] is None


# --- real data: rows that must be flagged, not guessed ----------------------

def test_moreno_valley_celebration_park_open_ended_time_is_flagged():
    # "Sun 10am onward" has no close time -- must not be guessed at.
    result = parse_hours_text("Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward")
    assert result.structured is None
    assert result.needs_review is True
    assert "onward" in result.reason or "10am onward" in result.reason


def test_moreno_valley_city_hall_parenthetical_caveat_is_flagged():
    # The core Mon-Fri hours ARE unambiguous, but the trailing parenthetical
    # ("some Development Services counters follow separate Friday hours")
    # is real information that would be silently lost if parsed away --
    # flagged for a human to judge, not dropped.
    result = parse_hours_text(
        "Mon–Thu 7:30am–5:30pm, Fri 7:30am–4:30pm "
        "(some Development Services counters follow separate Friday hours)"
    )
    assert result.structured is None
    assert result.needs_review is True
    assert "parenthetical" in result.reason


def test_completely_unrecognized_text_is_flagged_not_silently_ignored():
    result = parse_hours_text("Call for hours")
    assert result.structured is None
    assert result.needs_review is True


def test_reversed_day_range_is_flagged_not_guessed():
    # A day range that runs backwards in week order (never seen in real
    # data, but must fail safe rather than silently wrap Sun->Mon).
    result = parse_hours_text("Fri-Mon 9am-5pm")
    assert result.structured is None
    assert result.needs_review is True
