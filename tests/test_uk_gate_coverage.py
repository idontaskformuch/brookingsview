"""Glasgow launch blocker (a): the UK gate (contempt of court, private persons) must sit on EVERY publishing path.

The gate lives inside guardrails.validate(). This test fails when a text generator is added that calls the Anthropic API without
going through guardrails.validate() (directly or via format_prompt's generate path), so a new generator can never silently skip it.
"""
import re
from pathlib import Path

from ai_pipeline import guardrails

AI_DIR = Path(__file__).resolve().parent.parent / "ai_pipeline"
CALLS_API = re.compile(r"safe_create\(|messages\.create\(|anthropic\.Anthropic\(")
GOES_THROUGH_GATE = re.compile(r"guardrails\.validate\(|format_prompt import [^\n]*\b(generate|generate_summary)\b|from ai_pipeline\.format_prompt import")
# helpers that call the API but never produce reader-facing text
NOT_A_GENERATOR = {"api_usage.py", "search_client.py", "format_prompt.py"}  # format_prompt IS the shared generator and calls validate() itself


def test_every_text_generator_goes_through_validate():
    missing = []
    for path in sorted(AI_DIR.glob("*.py")):
        src = path.read_text(encoding="utf-8")
        if path.name in NOT_A_GENERATOR or not CALLS_API.search(src):
            continue
        if not GOES_THROUGH_GATE.search(src):
            missing.append(path.name)
    assert not missing, f"generators that bypass guardrails.validate() (and so the UK gate): {missing}"


def test_format_prompt_itself_validates():
    assert "guardrails.validate(" in (AI_DIR / "format_prompt.py").read_text(encoding="utf-8")


GB = {"town_id": "glasgow", "country": "gb", "display_name": "Glasgow", "state": "Scotland"}
US = {"town_id": "brookings_sd", "display_name": "Brookings", "state": "South Dakota"}


def test_validate_holds_contempt_text_for_a_uk_town_only():
    text = "A man was arrested and will appear at the High Court after the trial date was set."
    src = "A man was arrested and will appear at the High Court after the trial date was set."
    uk = guardrails.validate(text, src, GB)
    assert not uk.passed and any(v.startswith("UK-spärr") for v in uk.violations)
    assert not any(v.startswith("UK-spärr") for v in guardrails.validate(text, src, US).violations)


def test_validate_passes_a_plain_council_sentence_for_a_uk_town():
    text = "The Licensing Board meets this week to consider its agenda."
    res = guardrails.validate(text, text, GB)
    assert not any(v.startswith("UK-spärr") for v in res.violations)
