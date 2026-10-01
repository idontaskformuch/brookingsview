"""Regression tests for validation/election_business_policy.py -- Phase 0
check 6, added 2026-10-01 after two real, live incidents (see that module's
own docstring): an editorial endorsing a position on a ballot measure, and
a separate editorial naming and criticizing a real local business.
"""
from validation.election_business_policy import check_election_business_policy

# Real, verbatim excerpt from broomfield_co/editorial-2026-09-08 ("Broomfield
# Shouldn't Help a Prosecutor Buy a Third Term"), unpublished 2026-10-01 for
# exactly this violation.
REAL_BALLOT_ENDORSEMENT = (
    "That process sounds fair enough. It isn't. The council should vote this "
    "resolution down, and if it doesn't, voters should treat it as what it "
    "is: an attempt to extend one official's hold on power dressed up as "
    "routine housekeeping."
)

# Real, verbatim excerpt from brookings_sd/editorial-2026-09-29 ("The Open
# House That Brookings Should Read as a Warning"), naming and framing a
# real local business critically.
REAL_NAMED_BUSINESS_CRITICISM = (
    "On October 6, Cornerstone Caregiving will throw open the doors of its "
    "new office for four hours of tours, refreshments, and a door-prize "
    "drawing. This is the open house Brookings should read as a warning "
    "sign about where the town is headed."
)


def test_flags_real_ballot_measure_endorsement():
    result = check_election_business_policy(REAL_BALLOT_ENDORSEMENT)
    assert not result.passed
    assert any("election/ballot" in v for v in result.violations)


def test_flags_real_named_business_criticism():
    result = check_election_business_policy(REAL_NAMED_BUSINESS_CRITICISM)
    assert not result.passed
    assert any("Cornerstone Caregiving" in v for v in result.violations)


def test_allows_describing_a_ballot_measure_without_endorsing_a_position():
    text = (
        "A resolution to extend district attorney term limits from two terms "
        "to three will go before voters in November, assuming both the city "
        "council and county commissioners approve putting it there. "
        "Supporters say longer terms let a prosecutor finish complex reforms; "
        "critics say extending any officeholder's time in power deserves "
        "scrutiny regardless of the arguments for it."
    )
    result = check_election_business_policy(text)
    assert result.passed, result.violations


def test_allows_criticizing_a_government_body():
    text = (
        "The City Council should answer for scheduling this candidate forum "
        "at nine in the morning, a time that excludes most working voters."
    )
    result = check_election_business_policy(text)
    assert result.passed, result.violations


def test_allows_vote_in_an_unrelated_routine_context():
    # "the council should vote" on a routine permit is allowed civic-process
    # critique -- only a vote tied to an election/ballot stake is forbidden.
    text = "The council should vote on the parking variance at its next meeting instead of delaying it again."
    result = check_election_business_policy(text)
    assert result.passed, result.violations


def test_allows_civic_process_critique_of_a_forum_format():
    text = (
        "The format, though, deserves scrutiny. If a pointed follow-up isn't "
        "asked when a candidate dodges the original question, the moderator "
        "may simply move on to the next card."
    )
    result = check_election_business_policy(text)
    assert result.passed, result.violations
