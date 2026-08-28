"""Closure Watch (/closures) -- pure-logic tests, no DB. See Handoff:
Information Hub Tier 1, Feature A.

compute_closure_watch_state() mirrors site/src/lib/closure-watch.ts's
computeClosureWatchState() exactly -- two independent implementations of the
same three-state decision, one per language, is precisely the setup that
drifts silently (same risk tests/test_feature_flags.py's cross-system check
was built for in Step 1). The state-machine cases below are loaded from
tests/fixtures/closure_watch_cases.json, which site/src/lib/closure-
watch.test.ts reads too -- a change to one implementation that the other
doesn't match fails HERE without anyone needing to remember to update two
independently-written test files by hand.
"""
import json
from pathlib import Path

from ai_pipeline.closure_watch_digest import build_grounding_text, compute_closure_watch_state
from ai_pipeline.guardrails import check_no_prediction

FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "closure_watch_cases.json"
GOLDEN_CASES = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

_DUMMY_CLOSURE = {"district": "Test District", "title": "t", "message": "m", "url": None, "posted_at": "2026-01-01"}
_DUMMY_ALERT = {"title": "Test Alert", "venue": None, "url": "https://example.com/alert", "raw_data": {}}


def test_golden_cases_state_machine():
    for case in GOLDEN_CASES:
        closures = [_DUMMY_CLOSURE] if case["hasClosure"] else []
        alert = _DUMMY_ALERT if case["hasAlert"] else None
        status = compute_closure_watch_state(closures, alert, case["historicalCount"], case["minRequired"])
        assert status["state"] == case["expectedState"], f"case {case['name']!r}: {status}"

CLOSURE = {
    "district": "Brookings School District 05-1",
    "title": "District closed today",
    "message": "All schools are closed today due to weather.",
    "url": "https://www.brookings.k12.sd.us/",
    "posted_at": "2026-02-01",
}

ALERT = {
    "title": "Winter Storm Warning",
    "venue": "Brookings County",
    "url": "https://api.weather.gov/alerts/abc123",
    "raw_data": {
        "headline": "Winter Storm Warning issued",
        "description": "Heavy snow expected.",
        "instruction": "Travel is not advised.",
    },
}


def test_watch_to_confirmed_transition():
    """Not expressible as a single golden case (it's two calls in sequence) --
    kept as an explicit regression alongside the golden-case loop above,
    using the same real ALERT/CLOSURE fixtures the grounding-text tests below
    already need."""
    before = compute_closure_watch_state([], ALERT, 0, 0)
    assert before["state"] == "watch"
    after = compute_closure_watch_state([CLOSURE], ALERT, 0, 0)
    assert after["state"] == "confirmed"


def test_grounding_text_omits_historical_line_when_count_is_zero():
    text = build_grounding_text(ALERT, "Brookings School District 05-1", "https://www.brookings.k12.sd.us/", 0)
    assert "Historical note" not in text
    assert "NONE -- no closure has been announced" in text


def test_grounding_text_includes_historical_line_when_count_is_positive():
    text = build_grounding_text(ALERT, "Brookings School District 05-1", "https://www.brookings.k12.sd.us/", 3)
    assert "3 time(s)" in text


# --- check_no_prediction -----------------------------------------------------

PREDICTIVE_EXAMPLES = [
    "Schools will close tomorrow due to the storm.",
    "Classes are likely to be canceled.",
    "There is a good chance the district cancels school.",
    "Parents should keep the kids home tomorrow.",
    "The district will probably close early.",
    "It's better safe than sorry, so plan for a snow day.",
    "Expect school to be closed given the severity of the warning.",
    "Classes could be cancelled if the storm intensifies.",
]

SAFE_EXAMPLES = [
    "A Winter Storm Warning is in effect for Brookings County through tomorrow morning.",
    "No closure has been announced. Check with the district directly for official notice.",
    "The district has not announced any delay or cancellation at this time.",
    "This kind of alert has preceded a closure 3 time(s) before, but no announcement has been made today.",
    "Heavy snow and strong winds are expected overnight.",
]


def test_check_no_prediction_rejects_predictive_language():
    for text in PREDICTIVE_EXAMPLES:
        result = check_no_prediction(text)
        assert not result.passed, f"expected rejection: {text!r}"


def test_check_no_prediction_allows_safe_situational_text():
    for text in SAFE_EXAMPLES:
        result = check_no_prediction(text)
        assert result.passed, f"expected pass: {text!r} (violations: {result.violations})"


def test_check_no_prediction_full_paragraph_with_mixed_content():
    good = (
        "A Winter Storm Warning is in effect for Brookings County through tomorrow "
        "morning. The district has not announced any closure, delay, or "
        "cancellation. Check the district's own notification channel for the "
        "official word."
    )
    assert check_no_prediction(good).passed

    bad = (
        "A Winter Storm Warning is in effect for Brookings County. Given the "
        "severity, schools will likely close tomorrow. Keep the kids home just "
        "in case."
    )
    result = check_no_prediction(bad)
    assert not result.passed
    assert len(result.violations) >= 1
