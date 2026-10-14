"""Regression tests for project entity matching (see
ai_pipeline/project_registry.py and NEEDS-HUMAN-REVIEW.md, "Week 3 -- City
Hall Project Pages"). Pure logic only, no DB connection.
"""
from ai_pipeline.project_registry import agenda_item_counter, agenda_item_text, extract_case_numbers, match_project
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


# --- agenda_item_text: eSCRIBE "description" vs AgendaLink "details" ------

def test_agenda_item_text_prefers_description_when_present():
    # eSCRIBE shape (scrapers/parsers/escribe_v1.py).
    assert agenda_item_text({"title": "x", "description": "the escribe body"}) == "the escribe body"


def test_agenda_item_text_falls_back_to_details():
    # AgendaLink shape (scrapers/parsers/agendalink_v1.py) -- no
    # "description" key at all, the real body is under "details". Before
    # this fix, every caller reading item.get("description") silently got
    # "" for every Broomfield agenda item, regardless of how much real
    # text the parser had actually captured.
    assert agenda_item_text({"title": "x", "details": "the agendalink body"}) == "the agendalink body"


def test_agenda_item_text_empty_when_neither_key_present():
    assert agenda_item_text({"title": "x"}) == ""


# --- agenda_item_counter: eSCRIBE "counter" vs AgendaLink "item_number" ---

def test_agenda_item_counter_prefers_counter_when_present():
    assert agenda_item_counter({"counter": "K.1.", "item_number": "191"}) == "K.1."


def test_agenda_item_counter_falls_back_to_item_number():
    # Real bug this guards against: two different AgendaLink items in the
    # SAME meeting (e.g. a Council resolution and its BURA companion) both
    # had agenda_item.get("counter") == "" before this fix, colliding on
    # project_updates' (project_id, meeting_id, agenda_counter) uniqueness
    # and silently overwriting each other -- only one ever got threaded.
    council_item = {"title": "Resolution No. 2026-107", "item_number": "191"}
    bura_item = {"title": "Resolution No. 2026-108-UR", "item_number": "194"}
    assert agenda_item_counter(council_item) == "191"
    assert agenda_item_counter(bura_item) == "194"
    assert agenda_item_counter(council_item) != agenda_item_counter(bura_item)


def test_agenda_item_counter_empty_when_neither_key_present():
    assert agenda_item_counter({"title": "x"}) == ""


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


def test_extract_case_numbers_finds_multiple():
    found = extract_case_numbers("CHANGE OF ZONE (PEN23-0076), PLOT PLAN (PEN23-0074)")
    assert found == ["PEN23-0074", "PEN23-0076"]


def test_extract_case_numbers_dedupes():
    found = extract_case_numbers("PEN24-0154 ... later also mentions PEN24-0154 again")
    assert found == ["PEN24-0154"]


def test_extract_case_numbers_handles_hyphen_line_wrap():
    found = extract_case_numbers("Ordinance amending PEN26- 0019")
    assert found == ["PEN26-0019"]


def test_extract_case_numbers_empty_when_none_present():
    assert extract_case_numbers("Ordinance No. 2306 -- Second Reading and Public Hearing") == []
