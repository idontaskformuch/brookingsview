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


def test_build_prompt_asks_for_a_short_intro_with_no_days_or_times():
    prompt = build_prompt(CFG, "August 24")
    assert "ONLY the short introduction" in prompt
    assert "at most 80 words" in prompt
    assert "NO days of the week, NO times, NO dates" in prompt
    assert "400-600" not in prompt


def test_template_fallback_is_a_short_count_only_intro():
    from ai_pipeline.weekly import template_fallback
    data = {"meetings": [{"body": "X"}], "events": [{"title": "a"}, {"title": "b"}], "games": []}
    text = template_fallback(data, "Oct 19-25", CFG)
    assert "1 public meeting, 2 community events" not in text  # joined with 'and', not a comma pair
    assert "1 public meeting and 2 community events" in text
    assert len(text.split()) < 60


def test_intro_format_guard_rejects_days_times_dates_and_lists():
    from ai_pipeline.weekly import intro_format_violations
    assert intro_format_violations("The council meets Tuesday morning to vote.")
    assert intro_format_violations("Hobo Day is on Saturday.")
    assert intro_format_violations("Doors open at 7 p.m. for the concert.")
    assert intro_format_violations("The concert is October 24 downtown.")
    assert intro_format_violations("First point.\n\nSecond paragraph.")
    assert intro_format_violations("Intro text.\n- a list item")
    assert intro_format_violations("word " * 100)


def test_intro_format_guard_accepts_a_clean_intro():
    from ai_pipeline.weekly import intro_format_violations
    ok = ("The County Commission weighs rescinding a burn ban and approving three residential plats, decisions "
          "that shape land development across the county. Campus and downtown fill with Hobo Day events, "
          "alongside several board meetings on topics from arts planning to disability access.")
    assert intro_format_violations(ok) == []
