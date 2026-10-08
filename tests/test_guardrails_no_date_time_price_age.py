"""Events correctness Phase 1, point 1 (2026-10-08): the three confirmed
live fabrications that prompted check_no_date_time_price_age_claims() --
see ai_pipeline/guardrails.py's own module comment for the full rationale.
"""
from ai_pipeline.guardrails import check_no_date_time_price_age_claims, validate_tone_v2


def test_rejects_an_invented_end_date():
    # Real example: "Moreno Valley: Free Food Giveaway" -- source
    # description was blank; the model invented "runs through mid-August"
    # for a giveaway that actually recurs with no end date.
    result = check_no_date_time_price_age_claims(
        "The giveaway runs through mid-August and is open to anyone who needs food assistance."
    )
    assert result.passed is False
    assert any("month name" in v for v in result.violations)


def test_rejects_an_invented_age_claim():
    # Real example: "Corpse Bride Outdoor Screening" -- source stated no
    # age policy at all.
    result = check_no_date_time_price_age_claims("All ages welcome.")
    assert result.passed is False
    assert any("age" in v for v in result.violations)


def test_rejects_a_stale_weekday_claim():
    # Real example: "IRIS PLAZA: Dragons in the Stacks" -- body said "every
    # Saturday" for a program that actually runs every Friday.
    result = check_no_date_time_price_age_claims("These sessions happen every Saturday evening.")
    assert result.passed is False
    assert any("cadence" in v for v in result.violations)


def test_rejects_a_clock_time():
    result = check_no_date_time_price_age_claims("Doors open at 6:00 PM.")
    assert result.passed is False
    assert any("clock time" in v for v in result.violations)


def test_rejects_a_dollar_amount():
    result = check_no_date_time_price_age_claims("Admission is $10 at the door.")
    assert result.passed is False
    assert any("dollar amount" in v for v in result.violations)


def test_passes_a_category_description_with_no_date_time_price_age():
    result = check_no_date_time_price_age_claims(
        "Tabletop role-playing, dice provided. A game master runs each session; walk-ins are welcome."
    )
    assert result.passed is True
    assert result.violations == []


def test_passes_a_stated_age_category_without_a_number():
    # "teens"/"adults"/"preschool" as a plain category word, no number and
    # no blanket "all ages" claim -- still allowed per the updated event
    # prompt rule (format_prompt.py's TONE_V2_TYPE_RULES["event"]).
    result = check_no_date_time_price_age_claims("A teen book club discussing this month's pick.")
    # "this month's" is a cadence-adjacent phrase but not one of the
    # matched patterns (no "every"/"monthly"/weekday/month-name) -- confirm
    # it doesn't accidentally trip a different rule.
    assert result.passed is True


def test_validate_tone_v2_applies_the_check_only_for_events():
    bad_summary = "The class runs from 6:00 PM every Tuesday."
    event_result = validate_tone_v2(bad_summary, {}, "", "event", {})
    assert event_result.passed is False

    # Alerts legitimately state duration/time in prose (§5's own "Lead with
    # the practical shape: what, where, how long" rule) -- must NOT be
    # policed by this check.
    alert_result = validate_tone_v2(bad_summary, {}, "", "alert", {})
    assert not any("date/time/price/age" in v for v in alert_result.violations)
