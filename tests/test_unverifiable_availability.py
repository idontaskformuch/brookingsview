"""Regression tests for validation/unverifiable_availability.py -- Phase 0
check 7, added 2026-10-01. content/now_playing.py has no source anywhere for
real showtimes or confirmed current theater availability (Wikidata +
Wikipedia + a verified theater name/address/phone, nothing more -- see that
module's own docstring), so any claim of current/temporal exhibition status
in a review is unsourced by construction.
"""
from validation.unverifiable_availability import check_unverifiable_availability

# Real, verbatim headlines from the 18 media_recension stories published
# across all 3 towns as of 2026-10-01 -- these are what calibrated the
# phrases below, not hypothetical examples.
REAL_HEADLINES = [
    "Nolan's \"The Odyssey\" Finally Lands, and Brookings Cinema 8 Has It on the Big Screen This Weekend",
    "Spider-Man swings back into Brookings, and Cinema 8 is the cheapest way to see it",
    "Cobra Slithers Back Into Brookings Cinema 8 for a 40th Anniversary Run",
    "Spider-Man: Brand New Day Swings Into Its Second Act, and Broomfield Still Has Time to Catch It",
    "Moreno Valley: The Odyssey Turns Homer Into a Nolan Puzzle Box, and Mostly Wins",
    "Spider-Man: Brand New Day swings into Moreno Valley, and locals get first crack at it this weekend",
    "Supergirl Lands in the DCU, and Moreno Valley Gets First Crack at It",
]


def test_flags_big_screen_this_weekend():
    result = check_unverifiable_availability(REAL_HEADLINES[0], "media_recension")
    assert not result.passed
    assert any("big screen" in v for v in result.violations)


def test_flags_cheapest_way_to_see_it():
    result = check_unverifiable_availability(REAL_HEADLINES[1], "media_recension")
    assert not result.passed


def test_allows_anniversary_run_with_no_availability_claim():
    # "40th Anniversary Run" is a factual re-release framing, not a claim of
    # current showing -- nothing here should trip the check.
    result = check_unverifiable_availability(REAL_HEADLINES[2], "media_recension")
    assert result.passed, result.violations


def test_flags_still_has_time_to_catch_it():
    result = check_unverifiable_availability(REAL_HEADLINES[3], "media_recension")
    assert not result.passed


def test_allows_a_review_with_no_availability_language_at_all():
    result = check_unverifiable_availability(REAL_HEADLINES[4], "media_recension")
    assert result.passed, result.violations


def test_flags_first_crack_at_it_this_weekend():
    result = check_unverifiable_availability(REAL_HEADLINES[5], "media_recension")
    assert not result.passed


def test_flags_first_crack_without_this_weekend_too():
    # the direct-phrase "first crack" alone (no "this weekend" nearby) is
    # still an availability claim this pipeline can't back.
    result = check_unverifiable_availability(REAL_HEADLINES[6], "media_recension")
    assert not result.passed


def test_flags_now_playing_and_showtimes_directly():
    for phrase in ("now playing", "now showing", "showtimes", "buy tickets",
                   "still in theaters", "currently playing"):
        result = check_unverifiable_availability(f"The film is {phrase} across town.", "media_recension")
        assert not result.passed, f"expected a violation for {phrase!r}"


def test_naming_a_real_theater_alone_is_not_a_violation():
    # Naming a verified real theater is explicitly allowed (review_standard.py's
    # own non-negotiable #6) -- only a CURRENT-availability claim is not.
    text = "Brookings Cinema 8 is the kind of theater where a film like this belongs."
    result = check_unverifiable_availability(text, "media_recension")
    assert result.passed, result.violations


def test_this_weekend_alone_with_no_theater_language_is_not_flagged():
    text = "The council meets this weekend to finalize the budget."
    result = check_unverifiable_availability(text, "media_recension")
    assert result.passed, result.violations


def test_scoped_to_media_recension_only():
    # The exact same violating text must pass for every other content type --
    # this check only applies to reviews (module docstring).
    text = "Catch it this weekend on the big screen -- now playing everywhere."
    for other_type in ("editorial", "culture_essay", "kvick_essa", "vetenskap_kronika",
                       "vardagsmiddag", None):
        result = check_unverifiable_availability(text, other_type)
        assert result.passed, f"should not apply to content_type={other_type!r}"
