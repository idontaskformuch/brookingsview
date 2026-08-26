"""Tests for the Summary Tone Prompts v2 JSON contract (see
NEEDS-HUMAN-REVIEW.md "Summary Tone Prompts -- scraped local items" and
ai_pipeline/format_prompt.py's own tone_v2 section)."""
import json

from ai_pipeline.format_prompt import (
    build_system_prompt_v2, parse_tone_v2_response, TONE_V2_MAX_SENTENCES,
)

CFG = {"display_name": "Moreno Valley", "state": "California"}


def test_parse_tone_v2_response_plain_json():
    raw = json.dumps({"summary": "Tabletop role-playing, dice provided.",
                       "meta": {"venue": "Main Library", "when": "August 25"}})
    parsed = parse_tone_v2_response(raw)
    assert parsed is not None
    summary, meta = parsed
    assert summary == "Tabletop role-playing, dice provided."
    assert meta == {"venue": "Main Library", "when": "August 25"}


def test_parse_tone_v2_response_strips_markdown_fences():
    raw = "```json\n" + json.dumps({"summary": "Free food giveaway.", "meta": {}}) + "\n```"
    parsed = parse_tone_v2_response(raw)
    assert parsed is not None
    assert parsed[0] == "Free food giveaway."


def test_parse_tone_v2_response_omits_empty_meta_fields():
    raw = json.dumps({"summary": "Text.", "meta": {"venue": "Main Library", "phone": ""}})
    _, meta = parse_tone_v2_response(raw)
    assert meta == {"venue": "Main Library"}


def test_parse_tone_v2_response_missing_meta_key_is_fine():
    raw = json.dumps({"summary": "Text."})
    parsed = parse_tone_v2_response(raw)
    assert parsed == ("Text.", {})


def test_parse_tone_v2_response_rejects_malformed_json():
    assert parse_tone_v2_response("not json at all") is None


def test_parse_tone_v2_response_rejects_missing_summary():
    assert parse_tone_v2_response(json.dumps({"meta": {"venue": "x"}})) is None


def test_parse_tone_v2_response_rejects_empty_summary():
    assert parse_tone_v2_response(json.dumps({"summary": "   "})) is None


def test_parse_tone_v2_response_rejects_non_dict_meta():
    assert parse_tone_v2_response(json.dumps({"summary": "Text.", "meta": "not a dict"})) is None


def test_build_system_prompt_v2_includes_type_specific_rules():
    event_prompt = build_system_prompt_v2(CFG, "event")
    assert "hard ceiling of four" in event_prompt.lower()
    meeting_prompt = build_system_prompt_v2(CFG, "meeting")
    assert "up to 8 sentences" in meeting_prompt.lower()
    assert "hard ceiling of four" not in meeting_prompt.lower()


def test_build_system_prompt_v2_requests_json_output():
    prompt = build_system_prompt_v2(CFG, "alert")
    assert '"summary"' in prompt
    assert '"meta"' in prompt


def test_tone_v2_max_sentences_covers_all_three_types():
    assert set(TONE_V2_MAX_SENTENCES) == {"meeting", "event", "alert"}
