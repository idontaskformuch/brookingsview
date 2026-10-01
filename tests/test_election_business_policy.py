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


# Full, verbatim body of brookings_sd/editorial-2026-09-29 ("The Open House
# That Brookings Should Read as a Warning"), unpublished 2026-10-01. This is
# the complete published text, not an excerpt -- locks in the real incident
# exactly as it reached readers, not a trimmed version that might pass for
# reasons the full article doesn't share (e.g. extra surrounding text diluting
# a proximity window).
REAL_EDITORIAL_2026_09_29_TITLE = "The Open House That Brookings Should Read as a Warning"
REAL_EDITORIAL_2026_09_29_BODY = """On October 6, Cornerstone Caregiving will throw open the doors of its new office for four hours of tours, refreshments, and a door-prize drawing. It is a pleasant, low-stakes community event, the kind of ribbon-cutting Brookings hosts routinely. But the arrival of another in-home caregiving company in this town is not merely a nice gesture toward neighborliness. It is a data point, and city hall should be reading it as one instead of treating it as a footnote to the calendar.

Brookings likes to think of itself as a young town, and in one sense it is. South Dakota State University keeps the median age artificially low on paper, filling the city with twenty-year-olds who cycle through in four-year bursts. But strip out the student population and look at the rest of the community, and a different picture emerges: a graying town, like most of rural South Dakota, where the number of residents who need help bathing, cooking, and getting to appointments is growing faster than the infrastructure built to support them. Cornerstone Caregiving is not the first home-care company to set up shop here in recent years, and it will not be the last. That pattern deserves more scrutiny than a punch-and-cookies open house tends to invite.

The problem is not that caregiving businesses are opening. It is that their growth is happening in a vacuum, disconnected from the planning decisions the city is actually making. Look at what occupied the council's attention this fall: a conditional use permit for a home office, the dissolution of a tax increment district, the termination of a development agreement with a private corporation. These are the unglamorous mechanics of municipal governance, and they matter. But nowhere in that agenda is a serious conversation about whether Brookings' sidewalks connect aging residents to the clinics and caregiving offices multiplying around town, or whether Dial-a-Ride service can keep pace with a population that is losing its ability to drive faster than the city is losing its ability to notice.

Consider the walk-in flu shot clinic Avera Brookings runs during standard business hours, Monday through Friday. It is a genuinely useful service. But it also assumes a client who can get to a clinic on foot, by car, or with someone willing to drive them. For a growing number of Brookings residents, that assumption is already false, and it will be false for more of them next year, and the year after that. The city's health and caregiving infrastructure is expanding. The transportation and pedestrian infrastructure meant to connect people to it is not expanding at the same rate, or in some cases at all.

This is where Brookings should be more demanding, not less. When the council uses tools like tax increment financing to attract development, or negotiates development agreements with outside corporations, it has leverage it is not using. It could require age-friendly design standards from developers who benefit from public incentives: wider sidewalks, better lighting, curb cuts that actually meet code rather than technically satisfying it. It could extend Dial-a-Ride hours to match the actual schedules of caregiving appointments rather than the schedules of downtown business hours. None of this is exotic. Plenty of Midwestern towns facing the same demographic math have started doing exactly this. Brookings has not, because nothing on its agenda forces the question.

An open house with door prizes is an easy thing to attend and an easy thing to forget. The temptation is to file it under "nice things happening in town" and move on to the next item on the community calendar. But Cornerstone Caregiving's arrival, layered on top of the flu clinic, the disability committee's ongoing work, and the caregiving businesses that came before it, adds up to something the city has not yet named out loud: Brookings is becoming an older town, and its physical infrastructure has not caught up. The ribbon-cutting is worth attending. The question it raises is worth answering."""


def test_flags_the_real_published_cornerstone_caregiving_editorial():
    # The actual incident: unpublished 2026-10-01 after being identified in
    # review but left live through an earlier pass of this cleanup. The
    # check itself already catches the full article (verified against the
    # live DB row before unpublishing) -- this test locks that in so a
    # future change to the check can't silently stop catching it.
    result = check_election_business_policy(
        f"{REAL_EDITORIAL_2026_09_29_TITLE}\n{REAL_EDITORIAL_2026_09_29_BODY}"
    )
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
