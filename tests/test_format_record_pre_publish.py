"""End-to-end regression test for ai_pipeline/format_prompt.py:format_record()'s
new pre-publish gate (validation/pre_publish_check.py) -- the meeting/event/
alert choke point, format_record() itself had NO test coverage at all before
this (confirmed 2026-09-03: no test file calls it directly).

Both fixtures deliberately trip a Phase 0 check that ai_pipeline/guardrails.py's
PRE-EXISTING validate() would NOT catch on its own (a date-coherence mismatch,
not a fabricated proper noun/number) -- proving the NEW pre_publish_check
integration actually runs, rather than the test accidentally only exercising
guardrails.validate(), which already ran before it and would mask the new
code path if it happened to reject the same draft for its own, older reasons.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

from ai_pipeline.format_prompt import format_record

BROOKINGS_CFG = {
    "town_id": "brookings_sd", "display_name": "Brookings", "state": "SD",
    "timezone": "America/Chicago", "ai": {"monthly_budget_usd": 20, "tone_v2": False},
}
BROOKINGS_TONE_V2_CFG = {
    "town_id": "brookings_sd", "display_name": "Brookings", "state": "SD",
    "timezone": "America/Chicago", "ai": {"monthly_budget_usd": 20, "tone_v2": True},
}


class _FakeUsage:
    input_tokens = 10
    output_tokens = 20


def _fake_message(text: str) -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=_FakeUsage(), stop_reason="end_turn",
    )


class _ScriptedClient:
    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.calls = 0
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls += 1
        return _fake_message(self._responses.pop(0))


def test_date_incoherent_meeting_summary_falls_back_to_the_safe_raw_title():
    # meeting_date is a Monday; the AI keeps claiming Thursday even after
    # a retry -- guardrails.validate() has no opinion on this (no fabricated
    # proper noun/number involved), only the new date-coherence check does.
    monday = datetime(2026, 9, 7, 18, 0, tzinfo=timezone.utc)
    record = {"body": "City Council", "meeting_date": monday, "id": 501}
    bad_draft = "The council meets Thursday night to vote on the ordinance."
    client = _ScriptedClient([bad_draft, bad_draft])  # wrong even after the retry

    result = format_record(record, "meeting", BROOKINGS_CFG, client=client)

    assert result.generated_by == "template_fallback"
    assert result.text == "City Council"  # the safe raw field, never the rejected AI text
    assert client.calls == 2  # one retry attempted, then gave up


def test_date_coherent_meeting_summary_is_accepted():
    monday = datetime(2026, 9, 7, 18, 0, tzinfo=timezone.utc)
    record = {"body": "City Council", "meeting_date": monday, "id": 502}
    good_draft = "The council meets Monday night to vote on the ordinance."
    client = _ScriptedClient([good_draft])

    result = format_record(record, "meeting", BROOKINGS_CFG, client=client)

    assert result.generated_by.startswith("ai:")
    assert result.text == good_draft
    assert client.calls == 1


def test_tone_v2_date_incoherent_event_falls_back_to_the_safe_raw_title():
    import json
    monday = datetime(2026, 9, 7, 18, 0, tzinfo=timezone.utc)
    record = {"title": "Fall Festival", "starts_at": monday, "venue": "Pioneer Park", "id": 601}
    bad_json = json.dumps({"summary": "The festival runs Thursday at the park.",
                            "meta": {"venue": "Pioneer Park", "when": "September 7"}})
    client = _ScriptedClient([bad_json, bad_json])

    result = format_record(record, "event", BROOKINGS_TONE_V2_CFG, client=client)

    assert result.generated_by == "template_fallback"
    assert result.text == "Fall Festival"
    assert client.calls == 2
