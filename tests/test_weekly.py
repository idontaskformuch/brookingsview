"""Tests for ai_pipeline/weekly.py's prompt text (see AdSense "low value
content" remediation, Phase A6 -- roundups must read as synthesis, not a
re-listing)."""
from ai_pipeline.weekly import build_prompt

CFG = {"display_name": "Test Town", "state": "Test State"}


def test_build_prompt_requests_synthesis_grounded_in_source():
    prompt = build_prompt(CFG, "August 24")
    assert "SYNTHESIS" in prompt
    assert "grounded ONLY in what the source data states" in prompt


def test_build_prompt_still_bans_predicting_outcomes():
    prompt = build_prompt(CFG, "August 24")
    assert "Never predict an outcome" in prompt
