"""Regression tests for validation/incoherent_fragments.py (Phase 0 check 5)."""
from validation.incoherent_fragments import check_incoherent_fragments

MEETING_RECORD = {
    "body": "City Council", "meeting_date": "2026-09-10",
    "raw_data": {"agenda_items": ["Approve the downtown parking study contract"]},
}


def test_passes_clean_extractive_text():
    text = "The council will vote on the downtown parking study contract Tuesday."
    result = check_incoherent_fragments(text, MEETING_RECORD, "meeting")
    assert result.passed


def test_extractive_type_fails_on_a_sentence_with_no_source_overlap():
    text = ("The council will vote on the downtown parking study contract Tuesday. "
            "Meanwhile astronauts prepared a new lunar rover for its next mission.")
    result = check_incoherent_fragments(text, MEETING_RECORD, "meeting")
    assert not result.passed
    assert any("lunar rover" in v for v in result.violations)


def test_corruption_is_flagged_regardless_of_content_type():
    # A replacement-character run is never acceptable, extractive type or not.
    text = "The council will vote on the parking study ������ contract."
    result = check_incoherent_fragments(text, MEETING_RECORD, "meeting")
    assert not result.passed
    assert any("corrupted" in v for v in result.violations)


# --- interpretive content: overlap check must NOT apply -----------------
# "This is worth pausing on, not because a scheduling error is scandalous,
# but because it is instructive" is a real sentence from the culture essay
# this whole handoff references (culture_essay-2026-08-03, moreno_valley_ca,
# see NEEDS-HUMAN-REVIEW.md) -- genuinely on-topic, on-voice analysis with
# zero word-for-word echo of any source record. Flagging sentences like this
# would break the content track's entire reason for existing.

ESSAY_SOURCE_RECORD = {
    "topic": "library programming mixup", "detail": "Toddler Time at the Iris Plaza branch",
}


def test_interpretive_type_does_not_flag_analysis_with_no_source_overlap():
    text = ("This is worth pausing on, not because a scheduling error is scandalous, "
            "but because it is instructive.")
    result = check_incoherent_fragments(text, ESSAY_SOURCE_RECORD, "culture_essay")
    assert result.passed


def test_interpretive_type_still_flags_real_corruption():
    text = "This is worth pausing on ��������, because it is instructive."
    result = check_incoherent_fragments(text, ESSAY_SOURCE_RECORD, "culture_essay")
    assert not result.passed


def test_unknown_content_type_defaults_to_no_overlap_check():
    # A content_type not in EXTRACTIVE_CONTENT_TYPES (None, or a type this
    # check doesn't recognize) must fail safe toward NOT flagging interpretive
    # prose -- see EXTRACTIVE_CONTENT_TYPES' own explicit allowlist shape.
    text = "A reflection with no literal echo of any source record's wording at all."
    result = check_incoherent_fragments(text, ESSAY_SOURCE_RECORD, None)
    assert result.passed


def test_short_sentences_are_not_flagged_for_overlap():
    # Too little text for the overlap signal to mean anything -- a short,
    # legitimate transition sentence must not be flagged.
    text = "The vote passed. It was unanimous. Council adjourned shortly after."
    result = check_incoherent_fragments(text, MEETING_RECORD, "meeting")
    assert result.passed
