"""Tests for the Summary Tone Prompts post-generation checks (see
NEEDS-HUMAN-REVIEW.md "Summary Tone Prompts -- scraped local items" and
ai_pipeline/guardrails.py's own tone_v2 section)."""
from ai_pipeline.guardrails import (
    classify_opening, opening_diversity_ok, overrepresented_opening_shapes, validate_tone_v2,
)


def test_classify_opening_flags_subject_verb_shape():
    assert classify_opening("The Planning Commission will hold a hearing.") == "subject_verb"
    assert classify_opening("Discovery Club meets every Tuesday.") == "subject_verb"


def test_classify_opening_article_shape():
    assert classify_opening("The council reviewed three permits.") == "article"


def test_classify_opening_gerund_shape():
    assert classify_opening("Tabletop role-playing, adults welcome.") == "gerund"


def test_classify_opening_other_for_unclassified_text():
    assert classify_opening("Free food giveaway every Sunday.") == "other"


def test_opening_diversity_ok_under_threshold():
    recent = ["other"] * 7 + ["article"] * 2
    assert opening_diversity_ok("article", recent) is True


def test_opening_diversity_rejects_over_threshold():
    recent = ["subject_verb"] * 3
    assert opening_diversity_ok("subject_verb", recent) is False


def test_opening_diversity_never_polices_other():
    recent = ["other"] * 20
    assert opening_diversity_ok("other", recent) is True


def test_validate_tone_v2_requires_when_if_source_has_one():
    result = validate_tone_v2(
        "Tabletop role-playing, dice provided.", {}, "starts_at 2026-08-25T18:00:00",
        "event", {}, has_when_in_source=True,
    )
    assert not result.passed
    assert any("meta.when" in v for v in result.violations)


def test_validate_tone_v2_passes_when_meta_has_required_fields():
    result = validate_tone_v2(
        "Tabletop role-playing, dice provided. Adults welcome.",
        {"when": "August 25", "venue": "Main Library"},
        "Main Library starts_at 2026-08-25T18:00:00",
        "event", {}, has_when_in_source=True, has_venue_in_source=True,
    )
    assert result.passed


def test_validate_tone_v2_rejects_banned_adjective():
    result = validate_tone_v2(
        "This is a long-awaited renovation of the library.", {}, "renovation of the library",
        "event", {},
    )
    assert not result.passed
    assert any("long-awaited" in v for v in result.violations)


def test_validate_tone_v2_rejects_em_dash():
    result = validate_tone_v2(
        "The council meets Tuesday — agenda items include zoning.", {},
        "council meets tuesday zoning", "meeting", {},
    )
    assert not result.passed
    assert any("em dash" in v for v in result.violations)


def test_validate_tone_v2_rejects_invented_number():
    result = validate_tone_v2(
        "The project covers 42 acres.", {}, "the project covers a large area",
        "meeting", {},
    )
    assert not result.passed
    assert any("42" in v for v in result.violations)


def test_validate_tone_v2_allows_number_present_only_in_meta():
    result = validate_tone_v2(
        "Call 951-413-3880 for details.", {"phone": "951-413-3880"},
        "the library phone line is available", "event", {},
    )
    assert result.passed


def test_validate_tone_v2_enforces_event_sentence_ceiling():
    five_sentences = "One. Two. Three. Four. Five."
    result = validate_tone_v2(five_sentences, {}, "one two three four five", "event", {})
    assert not result.passed
    assert any("exceeds event ceiling" in v for v in result.violations)


def test_validate_tone_v2_no_longer_blocks_on_opening_repetition():
    # 2026-10-02 fix: the post-generation diversity gate self-deadlocked
    # (found live -- see NEEDS-HUMAN-REVIEW.md) once a town's last-10-
    # published pool saturated with one shape, since a rejected draft never
    # got published to dilute the pool. It's advisory-only now (pre-
    # generation prompt steering, see format_prompt.opening_steering_clause),
    # never a pass/fail violation -- validate_tone_v2() doesn't even take a
    # recent_openings argument anymore.
    result = validate_tone_v2(
        "Council will meet Tuesday to review the budget.", {}, "council meets tuesday budget",
        "meeting", {},
    )
    assert result.passed
    assert not any("opening shape" in v for v in result.violations)


def test_overrepresented_opening_shapes_flags_dominant_shape():
    recent = ["subject_verb", "subject_verb", "subject_verb", "article"]
    assert overrepresented_opening_shapes(recent) == ["subject_verb"]


def test_overrepresented_opening_shapes_empty_pool():
    assert overrepresented_opening_shapes([]) == []


def test_overrepresented_opening_shapes_excludes_other_even_when_dominant():
    assert overrepresented_opening_shapes(["other"] * 9 + ["article"]) == []


def test_overrepresented_opening_shapes_none_under_threshold():
    recent = ["subject_verb", "article", "gerund", "other"]
    assert overrepresented_opening_shapes(recent) == []
