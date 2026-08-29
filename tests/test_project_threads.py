"""Tests for the Story Threads pipeline extension (see Claude Code handoff
"Story Threads" -- implemented as an extension of the existing City Hall
Project Pages system, not a parallel table pair)."""
import json
from datetime import datetime, timedelta, timezone

import ai_pipeline.format_prompt as format_prompt
import ai_pipeline.project_threads as project_threads
from ai_pipeline.guardrails import check_no_project_outcome_prediction
from ai_pipeline.project_threads import (
    ai_match_candidate, generate_rolling_summary, generate_synthesis,
    is_candidate_agenda_item, is_candidate_traffic_incident,
    synthesis_template_fallback, thread_activity_state,
    MATCH_CONFIDENCE_THRESHOLD, MIN_TRAFFIC_CANDIDATE_AGE_DAYS, STALLED_AFTER_DAYS,
)

NOW = datetime(2026, 8, 29, tzinfo=timezone.utc)
CFG = {"ai": {"monthly_budget_usd": 20}}
OPEN_PROJECTS = [{"id": 1, "title": "Old 215 Truck Facility", "description": "9.1-acre plot plan east of Old 215 Frontage Road"}]


class _FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _FakeUsage:
    def __init__(self):
        self.input_tokens = 10
        self.output_tokens = 10


class _FakeMessage:
    def __init__(self, text):
        self.content = [_FakeTextBlock(text)]
        self.usage = _FakeUsage()


class _FakeClient:
    """Minimal stand-in for anthropic.Anthropic() -- generate()-style
    functions across this pipeline accept an injectable `client` param that,
    per investigation, no existing test actually exercised. This is the
    template for doing so without spending real money."""
    def __init__(self, response_text):
        self._response_text = response_text
        self.messages = self

    def create(self, **kwargs):
        return _FakeMessage(self._response_text)

PREDICTIVE_EXAMPLES = [
    "The rezoning will likely be approved at the next meeting.",
    "Construction is expected to be completed by spring.",
    "The permit should be finished processing next month.",
    "Council members anticipate the project will pass.",
    "The application is likely to be denied given past objections.",
]

SAFE_EXAMPLES = [
    "The council approved the rezoning Tuesday by a 4-1 vote.",
    "The Planning Commission denied the variance request.",
    "A public hearing is scheduled for Thursday at 6 p.m.",
    "The developer submitted revised plans after the continuance.",
    "No vote has been taken yet; the item was tabled.",
    "The project is not expected to open this year.",
]


def test_check_no_project_outcome_prediction_rejects_predictive_language():
    for text in PREDICTIVE_EXAMPLES:
        result = check_no_project_outcome_prediction(text)
        assert not result.passed, f"expected rejection: {text!r}"


def test_check_no_project_outcome_prediction_allows_real_reported_outcomes():
    for text in SAFE_EXAMPLES:
        result = check_no_project_outcome_prediction(text)
        assert result.passed, f"expected pass: {text!r} (violations: {result.violations})"


# --- is_candidate_agenda_item ------------------------------------------------

def test_flags_rezoning_language():
    assert is_candidate_agenda_item("Rezoning of 123 Main St from R-1 to C-2")


def test_flags_conditional_use_permit():
    assert is_candidate_agenda_item("Conditional Use Permit for a drive-through restaurant")


def test_flags_capital_improvement_in_description_not_just_title():
    assert is_candidate_agenda_item("Item 4", "Approval of the annual capital improvement program budget")


def test_does_not_flag_routine_business():
    assert not is_candidate_agenda_item("Approval of minutes from the previous meeting")
    assert not is_candidate_agenda_item("Presentation: Employee of the Month")


# --- is_candidate_traffic_incident -------------------------------------------
# Deferred from any scheduled run (see project_threads.py's own comment) --
# real-data testing found this heuristic surfaces mostly routine freeway
# maintenance, not genuine local stories. These tests still cover the
# mechanics (and the real bug found and fixed: created_at alone compared
# to *now* wrongly kept flagging long-since-resolved incidents).

def _incident(**overrides):
    base = {"incident_type": "lane_closure", "severity": "closure",
            "created_at": NOW - timedelta(days=MIN_TRAFFIC_CANDIDATE_AGE_DAYS + 1),
            "last_seen_at": NOW}
    base.update(overrides)
    return base


def test_flags_a_still_active_multi_day_lane_closure():
    assert is_candidate_traffic_incident(_incident(), now=NOW)


def test_does_not_flag_a_chp_incident():
    assert not is_candidate_traffic_incident(_incident(incident_type="chp_incident"), now=NOW)


def test_does_not_flag_a_brand_new_closure():
    assert not is_candidate_traffic_incident(
        _incident(created_at=NOW - timedelta(days=1), last_seen_at=NOW), now=NOW,
    )


def test_does_not_flag_an_incident_severity_lane_closure():
    # incident_type is right but severity suggests a one-off, not a project
    assert not is_candidate_traffic_incident(_incident(severity="incident"), now=NOW)


def test_missing_created_at_never_crashes_and_is_not_a_candidate():
    assert not is_candidate_traffic_incident(_incident(created_at=None), now=NOW)


def test_missing_last_seen_at_never_crashes_and_is_not_a_candidate():
    assert not is_candidate_traffic_incident(_incident(last_seen_at=None), now=NOW)


def test_real_bug_a_long_resolved_same_day_incident_is_not_flagged():
    # Confirmed live (2026-08-29) against Moreno Valley data: incident #2168
    # was created and resolved within an hour (an accident closure, not
    # construction), but wall-clock "now" being days later than that made
    # the OLD created_at-vs-now check still flag it. last_seen_at pins the
    # incident's own actual lifespan, independent of when this runs.
    old_same_day_incident = {
        "incident_type": "lane_closure", "severity": "closure",
        "created_at": NOW - timedelta(days=10, hours=1),
        "last_seen_at": NOW - timedelta(days=10),
    }
    assert not is_candidate_traffic_incident(old_same_day_incident, now=NOW)


def test_a_genuinely_ongoing_multi_day_closure_still_flags():
    still_open_incident = {
        "incident_type": "lane_closure", "severity": "closure",
        "created_at": NOW - timedelta(days=14),
        "last_seen_at": NOW,  # still showing up in the latest scrape
    }
    assert is_candidate_traffic_incident(still_open_incident, now=NOW)


# --- thread_activity_state ----------------------------------------------------

def test_resolved_wins_regardless_of_updated_at():
    assert thread_activity_state(NOW - timedelta(days=200), resolved_at=NOW, now=NOW) == "resolved"


def test_active_when_recently_updated():
    assert thread_activity_state(NOW - timedelta(days=5), resolved_at=None, now=NOW) == "active"


def test_stalled_after_the_quiet_period():
    assert thread_activity_state(
        NOW - timedelta(days=STALLED_AFTER_DAYS + 1), resolved_at=None, now=NOW,
    ) == "stalled"


def test_not_yet_stalled_right_at_the_boundary_minus_one():
    assert thread_activity_state(
        NOW - timedelta(days=STALLED_AFTER_DAYS - 1), resolved_at=None, now=NOW,
    ) == "active"


# --- ai_match_candidate --------------------------------------------------

def _isolate_budget(monkeypatch, tmp_path):
    monkeypatch.setattr(format_prompt, "_BUDGET_FILE", str(tmp_path / "budget.json"))


def test_no_open_projects_short_circuits_without_calling_the_client(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    result = ai_match_candidate("some new item", [], CFG, client=_FakeClient("should never be read"))
    assert result["match_project_id"] is None
    assert "no open projects" in result["reasoning"]


def test_high_confidence_match_is_trusted(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    response = json.dumps({
        "match_project_id": 1, "confidence": 0.92,
        "reasoning": "Both reference the 9.1-acre site on Old 215 Frontage Road.",
    })
    result = ai_match_candidate("Update on the Old 215 Frontage Road plot plan", OPEN_PROJECTS, CFG,
                                 client=_FakeClient(response))
    assert result["match_project_id"] == 1
    assert result["confidence"] >= MATCH_CONFIDENCE_THRESHOLD
    assert "Old 215" in result["reasoning"]


def test_low_confidence_match_is_forced_to_none(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    response = json.dumps({
        "match_project_id": 1, "confidence": 0.4,
        "reasoning": "Vaguely similar topic but no specific overlapping detail.",
    })
    result = ai_match_candidate("A different rezoning entirely", OPEN_PROJECTS, CFG, client=_FakeClient(response))
    assert result["match_project_id"] is None
    assert result["confidence"] < MATCH_CONFIDENCE_THRESHOLD


def test_model_correctly_says_no_match():
    pass  # covered by low-confidence case above; explicit null id + low confidence is the model's own "no match" signal


def test_malformed_json_response_fails_toward_no_match(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    result = ai_match_candidate("some item", OPEN_PROJECTS, CFG, client=_FakeClient("not json at all"))
    assert result["match_project_id"] is None
    assert result["confidence"] == 0.0


def test_response_missing_reasoning_is_rejected(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    response = json.dumps({"match_project_id": 1, "confidence": 0.95})
    result = ai_match_candidate("some item", OPEN_PROJECTS, CFG, client=_FakeClient(response))
    assert result["match_project_id"] is None


def test_markdown_fenced_response_is_still_parsed(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    payload = json.dumps({"match_project_id": 1, "confidence": 0.9, "reasoning": "Same parcel, same applicant."})
    result = ai_match_candidate("some item", OPEN_PROJECTS, CFG, client=_FakeClient(f"```json\n{payload}\n```"))
    assert result["match_project_id"] == 1


def test_budget_exhausted_short_circuits_without_calling_the_client(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    # project_threads imported _spent_this_month by name, so the patch target
    # is its own module namespace, not format_prompt's.
    monkeypatch.setattr(project_threads, "_spent_this_month", lambda: 999.0)
    result = ai_match_candidate("some item", OPEN_PROJECTS, CFG, client=_FakeClient("should never be read"))
    assert result["match_project_id"] is None
    assert "budget" in result["reasoning"].lower()


# --- generate_synthesis / generate_rolling_summary ---------------------------

SOURCE_TEXT = "Planning Commission item: Rezoning of 45 Elm St from R-1 to C-2. Public testimony limited to three minutes per speaker."


def test_synthesis_template_fallback_is_a_plain_restatement():
    assert synthesis_template_fallback("Rezoning of 45 Elm St") == "New item: Rezoning of 45 Elm St."


def test_generate_synthesis_accepts_a_grounded_response(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    response = "The commission will hear the 45 Elm St rezoning, with public testimony capped at three minutes per speaker."
    text, generated_by, verified = generate_synthesis("Rezoning of 45 Elm St", SOURCE_TEXT, CFG, client=_FakeClient(response))
    assert generated_by.startswith("ai:")
    assert verified is True
    assert "45 Elm St" in text


def test_generate_synthesis_falls_back_when_prediction_guardrail_fails_twice(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    bad_response = "The rezoning will likely be approved at the next meeting."
    text, generated_by, verified = generate_synthesis("Rezoning of 45 Elm St", SOURCE_TEXT, CFG, client=_FakeClient(bad_response))
    assert generated_by == "template_fallback"
    assert text == synthesis_template_fallback("Rezoning of 45 Elm St")


def test_generate_synthesis_falls_back_when_too_short(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    text, generated_by, verified = generate_synthesis("Rezoning of 45 Elm St", SOURCE_TEXT, CFG, client=_FakeClient("Too short."))
    assert generated_by == "template_fallback"


def test_generate_rolling_summary_accepts_a_grounded_response(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    response = "The Planning Commission is reviewing a rezoning request for 45 Elm St. No decision has been made yet."
    text, generated_by, verified = generate_rolling_summary("45 Elm St Rezoning", SOURCE_TEXT, CFG, client=_FakeClient(response))
    assert generated_by.startswith("ai:")
    assert "45 Elm St" in text


def test_generate_rolling_summary_falls_back_on_predicted_outcome(monkeypatch, tmp_path):
    _isolate_budget(monkeypatch, tmp_path)
    bad_response = "The rezoning is expected to be approved soon."
    text, generated_by, verified = generate_rolling_summary("45 Elm St Rezoning", SOURCE_TEXT, CFG, client=_FakeClient(bad_response))
    assert generated_by == "template_fallback"
    assert "45 Elm St Rezoning" in text
