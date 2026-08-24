"""Tests for ai_pipeline/project_updates_legistar.py -- see
NEEDS-HUMAN-REVIEW.md, "Brookings -- City Hall Project Pages". Pure logic
only, no live API call (see the real, hand-verified fixtures below, taken
from actual webapi.legistar.com responses).
"""
from datetime import datetime, timezone

from ai_pipeline.project_updates_legistar import outcome_from_history, matter_citation_url, _date_only_noon_utc
from ai_pipeline.project_registry import status_for_outcome

# Real response for RES 25-055 (RTI, LLC lease), MatterId 8570.
REAL_APPROVED_HISTORY = {
    "MatterHistoryId": 90011,
    "MatterHistoryActionDate": "2025-05-27T00:00:00",
    "MatterHistoryActionName": "approved",
    "MatterHistoryActionBodyName": "City Council",
    "MatterHistoryPassedFlag": 1,
    "MatterHistoryPassedFlagName": "Pass",
}

# Real response for ORD 26-016's First Reading, MatterId 9145 -- a genuine
# procedural step with no vote yet (PassedFlagName is null).
REAL_FIRST_READING_HISTORY = {
    "MatterHistoryId": 98133,
    "MatterHistoryActionDate": "2026-04-28T00:00:00",
    "MatterHistoryActionName": "read into the record",
    "MatterHistoryActionBodyName": "City Council",
    "MatterHistoryPassedFlag": None,
    "MatterHistoryPassedFlagName": None,
}


def test_pass_flag_becomes_approved():
    assert outcome_from_history(REAL_APPROVED_HISTORY) == "Approved"


def test_fail_flag_becomes_denied():
    h = {**REAL_APPROVED_HISTORY, "MatterHistoryPassedFlagName": "Fail"}
    assert outcome_from_history(h) == "Denied"


def test_no_passed_flag_uses_real_action_name_not_a_guess():
    # A First Reading is real, verified information (the item WAS
    # introduced) -- it must never be forced into Approved/Denied/pending.
    assert outcome_from_history(REAL_FIRST_READING_HISTORY) == "Read into the record"


def test_no_passed_flag_and_no_action_name_falls_back_to_pending():
    h = {"MatterHistoryActionName": None, "MatterHistoryPassedFlagName": None}
    assert outcome_from_history(h) == "pending"


def test_read_into_the_record_stays_under_review_not_approved():
    # Real risk: a naive substring check could match "record" or similar
    # and misclassify a procedural step as a real outcome.
    assert status_for_outcome("Read into the record") == "under_review"


def test_approved_and_denied_status_mapping_matches_escribe_pipeline():
    assert status_for_outcome("Approved") == "approved"
    assert status_for_outcome("Denied") == "denied"


def test_date_only_action_date_anchors_at_noon_utc_not_midnight():
    # Real bug caught by inspecting an actual built page: storing
    # MatterHistoryActionDate's literal midnight as UTC and rendering it
    # in Central time shifted a real April 7 Planning Commission item back
    # to "April 6" on the page. Noon UTC survives any real US timezone
    # offset without crossing into the wrong calendar day.
    result = _date_only_noon_utc("2026-04-07T00:00:00")
    assert result == datetime(2026, 4, 7, 12, 0, 0, tzinfo=timezone.utc)


def test_date_only_handles_none():
    assert _date_only_noon_utc(None) is None


def test_citation_url_uses_the_verified_gateway_pattern():
    # LegislationDetail.aspx with the WebAPI's own MatterId/MatterGuid pair
    # returns "Invalid parameters!" (verified live) -- gateway.aspx?M=L
    # redirects correctly instead. Regression guard against reverting to
    # the broken direct-link form.
    url = matter_citation_url("cityofbrookings", 8570)
    assert url == "https://cityofbrookings.legistar.com/gateway.aspx?M=L&ID=8570"
    assert "LegislationDetail" not in url
