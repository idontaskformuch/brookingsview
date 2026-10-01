"""End-to-end regression test for content/_base.py:generate_article()'s
pre-publish gate (validation/pre_publish_check.py) -- the actual site of the
July-August 2026 contamination incident and the culture essay this handoff
references. No prior test exercised this retry-then-skip path with a mocked
AI client at all (confirmed 2026-09-03) -- every existing content-track test
either tests prompt SHAPE (test_content_prompts.py) or a fixture data class
(test_media_recension.py), never generate_article()'s own control flow.
"""
from types import SimpleNamespace

from content._base import generate_article

BROOKINGS_CFG = {"town_id": "brookings_sd", "display_name": "Brookings", "state": "SD"}


class _FakeUsage:
    input_tokens = 10
    output_tokens = 20


def _fake_message(text: str) -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=_FakeUsage(),
        stop_reason="end_turn",
    )


class _ScriptedClient:
    """Fake anthropic client returning one scripted response per call, in
    order -- so a test can script "bad draft, then a corrected retry"
    without a real API call."""

    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        text = self._responses.pop(0)
        return _fake_message(text)


CONTAMINATED_DRAFT = (
    "Moreno Valley Review: A New Restaurant Opens\n\n"
    "Moreno Valley diners have a new option this month, with reviews already "
    "circulating about the food and service in the Inland Empire."
)
CLEAN_RETRY = (
    "Brookings Review: A New Restaurant Opens\n\n"
    "Brookings diners have a new option this month, with reviews already "
    "circulating about the food and service downtown."
)
STILL_CONTAMINATED_RETRY = (
    "Brookings Review, Somehow Still About Moreno Valley\n\n"
    "Even after a correction attempt, this draft keeps talking about "
    "Moreno Valley and the Inland Empire instead of the actual town."
)


def test_a_wrong_town_draft_triggers_exactly_one_retry_then_succeeds():
    client = _ScriptedClient([CONTAMINATED_DRAFT, CLEAN_RETRY])
    article = generate_article(
        "You are a reviewer.", "local input about a new restaurant", existing_corpus=[],
        cfg=BROOKINGS_CFG, client=client, content_type="media_recension",
    )
    assert article is not None
    assert "Moreno Valley" not in article.body
    assert len(client.calls) == 2  # exactly one retry, not more


def test_a_draft_that_stays_contaminated_after_retry_publishes_nothing():
    client = _ScriptedClient([CONTAMINATED_DRAFT, STILL_CONTAMINATED_RETRY])
    article = generate_article(
        "You are a reviewer.", "local input about a new restaurant", existing_corpus=[],
        cfg=BROOKINGS_CFG, client=client, content_type="media_recension",
    )
    assert article is None
    assert len(client.calls) == 2  # gave up after the one retry, no third call


def test_a_clean_draft_on_the_first_try_never_retries():
    client = _ScriptedClient([CLEAN_RETRY])
    article = generate_article(
        "You are a reviewer.", "local input about a new restaurant", existing_corpus=[],
        cfg=BROOKINGS_CFG, client=client, content_type="media_recension",
    )
    assert article is not None
    assert len(client.calls) == 1


# Follow-up (2026-10-02) to the question "is election_business_policy a hard
# block or just a flag like review_standard.py's own checks?" -- this proves
# the answer with the SAME end-to-end harness as the wrong-town tests above,
# using the real published text of brookings_sd/editorial-2026-09-29. The
# check lives INSIDE pre_publish_check() (Phase 0 check 6), the SAME gate
# the wrong-town checks above go through -- there is only one enforcement
# path through generate_article() for all 6 checks, not a separate one per
# check, so this is a real test of the shared mechanism, not a new one.
CORNERSTONE_DRAFT = (
    "The Open House That Brookings Should Read as a Warning\n\n"
    "On October 6, Cornerstone Caregiving will throw open the doors of its new "
    "office for four hours of tours, refreshments, and a door-prize drawing. "
    "This is the open house Brookings should read as a warning sign about "
    "where the town is headed."
)
# A realistic retry: generate_article()'s own correction prompt is worded for
# the wrong-town check ("every place reference... belongs ONLY to {town}"),
# not specifically for election_business_policy -- so a retry that fixes
# nothing about the actual violation (still names the business critically)
# is the REALISTIC failure mode this test checks, not a contrived one.
CORNERSTONE_STILL_CRITICAL_RETRY = (
    "The Open House Brookings Residents Should Notice\n\n"
    "On October 6, Cornerstone Caregiving opens its new office. This is the "
    "open house Brookings should read as a warning sign about where the town "
    "is headed, and residents deserve to know it."
)
CORNERSTONE_FIXED_RETRY = (
    "A New Caregiving Option Opens Its Doors\n\n"
    "On October 6, a new in-home caregiving provider opens its office for "
    "tours and refreshments -- one data point in a broader pattern worth the "
    "city's attention as its population ages."
)


def test_election_business_policy_violation_blocks_publication_after_retry():
    """The actual incident: a Cornerstone-Caregiving-shaped draft that STAYS
    in violation after one retry publishes NOTHING -- same hard-block
    behavior as the wrong-town tests above, via the same pre_publish_check()
    gate. This is the code path that would have stopped
    editorial-2026-09-29 had the check existed before 2026-09-29 published
    it; it didn't exist yet that day (added 2026-10-01), which is the real,
    purely TEMPORAL reason that article got published -- not a flag-vs-block
    gap in the check itself."""
    client = _ScriptedClient([CORNERSTONE_DRAFT, CORNERSTONE_STILL_CRITICAL_RETRY])
    article = generate_article(
        "You are an editorial writer.", "local input about a caregiving business open house",
        existing_corpus=[], cfg=BROOKINGS_CFG, client=client, content_type="editorial",
    )
    assert article is None
    assert len(client.calls) == 2  # retried once, gave up, published nothing


def test_election_business_policy_violation_allows_a_genuinely_fixed_retry():
    # The flip side: if the retry actually removes the business-criticism
    # framing, it passes and publishes -- the gate blocks the VIOLATION,
    # not the topic area itself.
    client = _ScriptedClient([CORNERSTONE_DRAFT, CORNERSTONE_FIXED_RETRY])
    article = generate_article(
        "You are an editorial writer.", "local input about a caregiving business open house",
        existing_corpus=[], cfg=BROOKINGS_CFG, client=client, content_type="editorial",
    )
    assert article is not None
    assert "Cornerstone Caregiving" not in article.body
    assert len(client.calls) == 2


# 2026-10-01 cleanup round, item 1a: content/now_playing.py has no source
# anywhere for real showtimes or confirmed current theater availability --
# see validation/unverifiable_availability.py's own docstring. This proves
# that check is ALSO a hard block through the same shared gate, the same way
# the Cornerstone tests above proved it for election_business_policy -- not
# a separate enforcement path, and not the flag-then-publish behavior of
# review_standard.py's own non-negotiables.
REVIEW_AVAILABILITY_DRAFT = (
    "Nolan's Latest Finally Lands, and Brookings Cinema 8 Has It on the Big Screen This Weekend\n\n"
    "Brookings moviegoers can see it playing now at the local multiplex, with showtimes "
    "stacked all day this weekend."
)
REVIEW_AVAILABILITY_STILL_VIOLATING_RETRY = (
    "Nolan's Latest Arrives in Brookings\n\n"
    "It is still playing now at Brookings Cinema 8, the cheapest way to catch it this weekend."
)
REVIEW_AVAILABILITY_FIXED_RETRY = (
    "Nolan's Latest Arrives, and Brookings Has Its Own Take\n\n"
    "Brookings Cinema 8 is the kind of theater where a film like this belongs, and this is "
    "what the town should know about it."
)


def test_unverifiable_availability_violation_blocks_publication_after_retry():
    client = _ScriptedClient([REVIEW_AVAILABILITY_DRAFT, REVIEW_AVAILABILITY_STILL_VIOLATING_RETRY])
    article = generate_article(
        "You are a reviewer.", "local input about a new film release",
        existing_corpus=[], cfg=BROOKINGS_CFG, client=client, content_type="media_recension",
    )
    assert article is None
    assert len(client.calls) == 2  # retried once, gave up, published nothing


def test_unverifiable_availability_violation_allows_a_genuinely_fixed_retry():
    client = _ScriptedClient([REVIEW_AVAILABILITY_DRAFT, REVIEW_AVAILABILITY_FIXED_RETRY])
    article = generate_article(
        "You are a reviewer.", "local input about a new film release",
        existing_corpus=[], cfg=BROOKINGS_CFG, client=client, content_type="media_recension",
    )
    assert article is not None
    assert "playing now" not in article.body
    assert len(client.calls) == 2


def test_unverifiable_availability_does_not_apply_outside_media_recension():
    # The same availability-claim language is fine for a content type this
    # check doesn't scope to (e.g. an editorial quoting a review) -- it must
    # not be blocked by a check that only applies to media_recension.
    client = _ScriptedClient([REVIEW_AVAILABILITY_DRAFT])
    article = generate_article(
        "You are an editorial writer.", "local input about a theater reopening",
        existing_corpus=[], cfg=BROOKINGS_CFG, client=client, content_type="editorial",
    )
    assert article is not None
    assert len(client.calls) == 1
