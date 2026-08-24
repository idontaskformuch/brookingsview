"""Regression tests for project entity matching (see
ai_pipeline/project_registry.py and NEEDS-HUMAN-REVIEW.md, "Week 3 -- City
Hall Project Pages"). Pure logic only, no DB connection.
"""
from ai_pipeline.project_registry import match_project
from ai_pipeline.project_updates import _normalize_counter, action_summary_for_counter

CAR_WASH = {"id": 1, "slug": "car-wash", "title": "Car Wash", "case_numbers": ["PEN25-0098", "PEN25-0100"]}
SPECIFIC_PLAN = {"id": 2, "slug": "specific-plan", "title": "Specific Plan", "case_numbers": ["PEN26-0019"]}
PROJECTS = [CAR_WASH, SPECIFIC_PLAN]


def test_matches_on_exact_case_number():
    project, ambiguous = match_project(PROJECTS, "MASTER PLOT PLAN (PEN25-0098) AND CUP (PEN25-0100)")
    assert project == CAR_WASH
    assert ambiguous is None


def test_no_match_returns_none_not_a_guess():
    project, ambiguous = match_project(PROJECTS, "AWARD ROTATIONAL TOW SERVICE PROGRAM AGREEMENT")
    assert project is None
    assert ambiguous is None


def test_ambiguous_match_is_flagged_not_guessed():
    project, ambiguous = match_project(PROJECTS, "ITEM REFERENCING BOTH PEN25-0098 AND PEN26-0019")
    assert project is None
    assert ambiguous is not None
    assert {p["slug"] for p in ambiguous} == {"car-wash", "specific-plan"}


def test_hyphen_wrapped_case_number_still_matches():
    # Real pdfplumber artifact: a case number that line-wraps mid-PDF gets
    # extracted with a stray space after the hyphen. Verified against a
    # real Action Summary PDF that silently broke matching before this fix.
    project, _ = match_project(PROJECTS, "AMENDMENT TO THE VILLAGE SPECIFIC PLAN 204 (SP 204) (PEN26- 0019)")
    assert project == SPECIFIC_PLAN


def test_case_number_match_is_case_insensitive():
    project, _ = match_project(PROJECTS, "master plot plan (pen25-0098)")
    assert project == CAR_WASH


def test_description_is_also_searched():
    project, _ = match_project(PROJECTS, "SOME GENERIC TITLE", "References case PEN26-0019 in the body text.")
    assert project == SPECIFIC_PLAN


def test_normalize_counter_strips_trailing_period_only():
    # Real mismatch: the agenda HTML's own counter ("K.2") and the Action
    # Summary PDF's counter for the SAME item ("K.2.") differ by a
    # trailing period, verified against a real meeting.
    assert _normalize_counter("K.2") == _normalize_counter("K.2.")
    assert _normalize_counter("J.1.1") == _normalize_counter("J.1.1.")
    assert _normalize_counter("K.2") != _normalize_counter("K.3")


def test_action_summary_for_counter_matches_despite_period_difference():
    meeting = {"raw_data": {"action_summary_items": [
        {"counter": "K.2.", "title": "SPECIFIC PLAN AMENDMENT", "result": "Approved"},
    ]}}
    found = action_summary_for_counter(meeting, "K.2")
    assert found is not None
    assert found["result"] == "Approved"


def test_action_summary_for_counter_returns_none_when_absent():
    meeting = {"raw_data": {}}
    assert action_summary_for_counter(meeting, "I.1") is None
