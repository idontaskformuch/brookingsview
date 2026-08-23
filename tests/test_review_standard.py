"""Regression tests for content/recensioner/review_standard.py (see
NEEDS-HUMAN-REVIEW.md "Review Writing Standard"). Pure logic only -- takes
plain strings/dicts, no DB connection, no AI call.
"""
from content.recensioner.review_standard import check_review_standard

CFG = {"display_name": "Moreno Valley"}
VENUES = ["Harkins Moreno Valley 16", "Regency Theatres — Towngate 8"]

GOOD_BODY = (
    "Moreno Valley moviegoers finally get a wide, close-to-home release this "
    "weekend, and it is worth the trip to Harkins Moreno Valley 16.\n\n"
    "The backstory here is the real hook: shelved for a tax write-off, then "
    "rescued after public backlash, the film arrives with more baggage than "
    "most blockbusters ever carry.\n\n"
    "A coyote chases a roadrunner across the desert, and that is about all "
    "the premise anyone needs going in.\n\n"
    "Rotten Tomatoes puts it at a strong 93 percent, but Metacritic's more "
    "measured 72 tells a slightly different story, and that gap is worth "
    "taking seriously rather than waving away. My read, weighed against all "
    "of it, is that the film earns its praise more than its skeptics admit. "
    "The verdict: worth your time, especially if you grew up on the cartoons."
)


def test_passes_when_all_five_non_negotiables_present():
    result = check_review_standard("A Local Weekend Watch", GOOD_BODY, CFG, VENUES, has_review_scores=True)
    assert result.passed, result.violations


def test_fails_without_local_hook_in_opening():
    body = "A coyote chases a roadrunner. The verdict: worth your time regardless of where you live."
    result = check_review_standard("Generic Review", body, CFG, VENUES, has_review_scores=False)
    assert not result.passed
    assert any("local hook" in v for v in result.violations)


def test_fails_without_named_venue_when_venues_exist():
    body = ("Moreno Valley readers have a new option this weekend at a theater nearby. "
            "The verdict: worth your time.")
    result = check_review_standard("Review", body, CFG, VENUES, has_review_scores=False)
    assert not result.passed
    assert any("no verified local venue" in v for v in result.violations)


def test_venue_check_is_a_no_op_when_town_has_no_registered_theaters():
    body = "Moreno Valley readers have a lot to like here. The verdict: worth your time."
    result = check_review_standard("Review", body, CFG, [], has_review_scores=False)
    assert not any("verified local venue" in v for v in result.violations)


def test_fails_without_verdict_language():
    body = ("Moreno Valley gets this one this weekend, at Harkins Moreno Valley 16. "
            "A coyote chases a roadrunner across the desert.")
    result = check_review_standard("Review", body, CFG, VENUES, has_review_scores=False)
    assert not result.passed
    assert any("no clear verdict" in v for v in result.violations)


def test_fails_when_review_scores_given_but_reception_not_weighed():
    # Has a verdict, has a local hook and venue, but never engages with the
    # (provided) divided reception -- should still fail non-negotiable #3.
    body = ("Moreno Valley can catch this one now at Harkins Moreno Valley 16. "
            "A coyote chases a roadrunner. The verdict: worth your time.")
    result = check_review_standard("Review", body, CFG, VENUES, has_review_scores=True)
    assert not result.passed
    assert any("no contrast/dissent" in v for v in result.violations)


def test_flags_plot_summary_heavy_review():
    plot_heavy_sentences = " ".join([
        "The film follows a coyote who follows a roadrunner across the desert.",
        "The story follows the pair through canyon after canyon.",
        "The movie follows them past a cliff, then follows them past a cactus.",
        "It follows them into a tunnel, and follows them out the other side.",
    ])
    body = f"Moreno Valley readers can catch this at Harkins Moreno Valley 16. {plot_heavy_sentences} The verdict: worth your time."
    result = check_review_standard("Review", body, CFG, VENUES, has_review_scores=False)
    assert not result.passed
    assert any("plot-summary-heavy" in v for v in result.violations)


def test_missing_cfg_display_name_falls_back_to_venue_only():
    body = "Catch this one now at Harkins Moreno Valley 16. The verdict: worth your time."
    result = check_review_standard("Review", body, {}, VENUES, has_review_scores=False)
    assert not any("local hook" in v for v in result.violations)
