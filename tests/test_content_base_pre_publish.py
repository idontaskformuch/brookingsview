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
