"""Meta-only extraction (ai_pipeline/meta_only.py, owner 2026-11-07): the model returns only `meta`, every value is checked against
the source text in code, the row is stored as a template (generated_by "template") and there is no retry."""
import json
from types import SimpleNamespace

from ai_pipeline.format_prompt import format_record
from ai_pipeline.meta_only import build_system_prompt, parse_meta_response, template_body, validate_meta

SRC = (
    "Dragons in the Stacks. Tabletop role-playing at the Moreno Valley Public Library Mall Branch, 22500 Town Circle, Suite 2078. "
    "Starts Tue, Aug 25 at 6:00 PM. Free, all ages welcome. Meets weekly. Sign up: https://example.org/rsvp/42"
)


def _kept(meta, source_type="event", src=SRC):
    return validate_meta(meta, source_type, src)


def test_values_found_in_the_source_are_kept():
    kept, dropped = _kept({
        "venue": "Moreno Valley Public Library Mall Branch", "address": "22500 Town Circle, Suite 2078",
        "when": "Tuesday, August 25 at 6 PM", "registration": "https://example.org/rsvp/42",
    })
    assert not dropped
    assert kept["venue"] == "Moreno Valley Public Library Mall Branch"
    assert kept["when"] == "Tuesday, August 25 at 6 PM"  # abbreviations, "6:00 PM" == "6 PM" and filler words do not matter


def test_values_not_in_the_source_are_dropped():
    kept, dropped = _kept({"venue": "Riverside Convention Center", "address": "1 Main Street", "registration": "https://evil.example/x"})
    assert kept == {}
    assert {k for k, _, _ in dropped} == {"venue", "address", "registration"}


def test_keys_that_were_not_requested_are_dropped():
    kept, dropped = _kept({"phone": "555-1234", "affected_areas": "Everywhere"}, "event", SRC + " 555-1234 Everywhere")
    assert kept == {} and [r for _, _, r in dropped] == ["key not requested"] * 2
    assert _kept({"when": "Tuesday"}, "meeting", SRC)[0] == {}  # meetings are not asked for `when`


def test_empty_and_non_string_values():
    kept, dropped = _kept({"venue": "", "address": None, "cost": 5})
    assert kept == {} and [(k, r) for k, _, r in dropped] == [("cost", "not a string")]


def test_cost_is_free_or_an_amount_only():
    assert _kept({"cost": "free"})[0] == {"cost": "Free"}
    assert _kept({"cost": "Free"}, src="Admission is $10.")[0] == {}  # the source never says free
    assert _kept({"cost": "$10"}, src="Tickets $10 at the door")[0] == {"cost": "$10"}
    assert _kept({"cost": "£8 / £5"}, src="Tickets £8, concessions £5")[0] == {"cost": "£8 / £5"}
    assert _kept({"cost": "$12"}, src="Tickets $10 at the door")[0] == {}  # amount not in the source
    for prose in ("Ticket price includes wine tasting", "Regular admission", "$10 (children 5 and under free)", "not listed"):
        assert _kept({"cost": prose}, src=prose + " $10 free 5")[0] == {}, prose


def test_audience_uses_a_fixed_vocabulary_and_needs_its_cue():
    assert _kept({"audience": "all ages"})[0] == {"audience": "All ages"}
    assert _kept({"audience": "Adults"})[0] == {}  # the source never says adults
    assert _kept({"audience": "Ages 13 and up"}, src="Ages 13 and up")[0] == {}  # not in the vocabulary
    assert _kept({"audience": "Teens"}, src="A club for teens")[0] == {"audience": "Teens"}


def test_recurrence_only_cadences_the_site_reads_and_the_source_states():
    assert _kept({"recurrence": "Weekly"})[0] == {"recurrence": "Weekly"}
    assert _kept({"recurrence": "Monthly"})[0] == {}  # source says weekly
    assert _kept({"recurrence": "Second Wednesday of each month"}, src="Second Wednesday of each month")[0] == {}  # not read by the site
    assert _kept({"recurrence": "Every 2 weeks"}, src="Meets every 2 weeks")[0] == {"recurrence": "Every 2 weeks"}
    assert _kept({"recurrence": "One-time event"}, src="one-time event")[0] == {}


def test_over_long_values_are_dropped():
    long = "Library " * 40
    assert _kept({"venue": long}, src=long)[0] == {}


def test_parse_meta_response():
    assert parse_meta_response('{"meta": {"venue": "X"}}') == {"venue": "X"}
    assert parse_meta_response('```json\n{"meta": {}}\n```') == {}
    for bad in ("not json", '{"summary": "x"}', '{"meta": "x"}', "[]"):
        assert parse_meta_response(bad) is None


def test_prompt_is_short_and_asks_for_no_prose():
    p = build_system_prompt("event")
    assert "summary" not in p.lower() and len(p) < 1400
    assert "audience" not in build_system_prompt("meeting") and "cost" not in build_system_prompt("meeting")


def test_template_body_only_uses_title_and_kept_values():
    assert template_body("Dragons in the Stacks", "event", {"venue": "Mall Branch"}) == "Dragons in the Stacks at Mall Branch."
    assert template_body("Jazz at the Park", "event", {"venue": "the Park"}) == "Jazz at the Park."
    assert template_body("Jazz", "event", {}) == "Jazz."
    assert template_body("City Council — Nov 10", "meeting", {"address": "447 Main St"}) == "City Council — Nov 10. Location: 447 Main St."
    assert template_body("NWS alert.", "alert", {}) == "NWS alert."


# --- format_record ---------------------------------------------------------------------------------------------------

_ON = {t: {"enabled": True} for t in ("meeting", "event", "alert")}
CFG = {"town_id": "moreno_valley_ca", "display_name": "Moreno Valley", "state": "CA", "timezone": "America/Los_Angeles",
       "ai": {"monthly_budget_usd": 20, "tone_v2": True, "meta_only": True, "generators": _ON}}
RECORD = {"title": "Dragons in the Stacks", "description": SRC, "venue": "Moreno Valley Public Library Mall Branch"}


class _Client:
    def __init__(self, text):
        self.calls, self.kwargs = 0, []
        self.messages = SimpleNamespace(create=self._create)
        self._text = text

    def _create(self, **kwargs):
        self.calls += 1
        self.kwargs.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self._text)], stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=10, output_tokens=20))


def test_event_is_one_call_validated_and_stored_as_template():
    reply = json.dumps({"meta": {"venue": "Moreno Valley Public Library Mall Branch", "cost": "$99", "audience": "all ages",
                                 "summary": "x"}})
    client = _Client(reply)
    result = format_record(RECORD, "event", CFG, client=client)
    assert client.calls == 1 and "summary" not in client.kwargs[0]["system"].lower()
    assert result.generated_by == "template" and result.verified
    assert result.meta == {"venue": "Moreno Valley Public Library Mall Branch", "audience": "All ages"}  # $99 invented, summary not a key
    assert result.text == "Dragons in the Stacks at Moreno Valley Public Library Mall Branch."


def test_unparseable_reply_falls_back_without_a_retry():
    client = _Client("I could not do that")
    result = format_record(RECORD, "event", CFG, client=client)
    assert client.calls == 1
    assert result.generated_by == "template_fallback" and result.violations


def test_alert_never_calls_the_model():
    client = _Client('{"meta": {}}')
    result = format_record({"title": "Wind Advisory", "description": "Gusts to 50 mph"}, "alert", CFG, client=client)
    assert client.calls == 0 and result.generated_by == "template" and result.text == "Wind Advisory" and result.meta == {}


def test_flag_off_keeps_the_tone_v2_path():
    cfg = {**CFG, "ai": {**CFG["ai"], "meta_only": False}}
    client = _Client(json.dumps({"summary": "A tabletop game session.", "meta": {"venue": "Mall Branch"}}))
    result = format_record(RECORD, "event", cfg, client=client)
    assert result.generated_by.startswith("ai:")
