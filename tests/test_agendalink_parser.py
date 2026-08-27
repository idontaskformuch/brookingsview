"""Regression tests for scrapers/parsers/agendalink_v1.py's text extraction
-- pure functions only, no network. Confirmed live 2026-08-27 against
Broomfield, CO's real AgendaLink data (client slug "broomfield").
"""
import json

from scrapers.parsers.agendalink_v1 import (
    _extract_text_from_details, _extract_topics, _slate_to_text,
    _strip_unresolved_merge_fields,
)


def test_strips_double_brace_merge_fields():
    # caught live: a draft-status meeting's memo read literally
    # "Presented By: {{customField.presentedBy}} ... Meeting Date: {{meetingDate}}"
    text = "Presented By: {{customField.presentedBy}} Meeting Date: {{meetingDate}}"
    assert "{{" not in _strip_unresolved_merge_fields(text)
    assert "}}" not in _strip_unresolved_merge_fields(text)


def test_strips_malformed_single_close_brace_merge_field():
    # caught live: one real memo had a mismatched "{{presentedBy}" (two
    # open braces, one close) -- must not require balanced braces.
    text = "Presented By: {{presentedBy} Subject: Executive Session"
    result = _strip_unresolved_merge_fields(text)
    assert "{" not in result and "}" not in result
    assert "Presented By:" in result and "Subject: Executive Session" in result


def test_slate_placeholder_text_extracted_as_empty():
    # Slate's own "Type..." placeholder for an untouched empty field --
    # not real content, must not be extracted as if it were.
    nodes = json.loads('[{"type":"p","children":[{"text":"Type..."}]}]')
    assert _slate_to_text(nodes) == ""


def test_slate_real_content_extracted():
    nodes = json.loads('[{"type":"p","children":[{"text":"Real agenda content."}]}]')
    assert _slate_to_text(nodes) == "Real agenda content."


def test_extract_text_from_details_handles_json_strung_html():
    # `details` for a real content item is a JSON string whose value is
    # itself an HTML string (double-encoded) -- see module docstring.
    details = json.dumps("<p>Hello <strong>world</strong></p>")
    assert _extract_text_from_details(details) == "Hello world"


def test_extract_text_from_details_handles_slate_json():
    details = json.dumps([{"type": "p", "children": [{"text": "Plain text item."}]}])
    assert _extract_text_from_details(details) == "Plain text item."


def test_extract_text_from_details_empty_string_is_empty():
    assert _extract_text_from_details("") == ""


def test_extract_topics_skips_template_topics():
    topics = [
        {"templateTopic": True, "title": "Pledge of Allegiance", "details": "[]"},
        {"templateTopic": False, "title": "Real Item", "details": json.dumps("<p>Real content.</p>")},
    ]
    items = _extract_topics(topics)
    assert len(items) == 1
    assert items[0]["title"] == "Real Item"
    assert items[0]["details"] == "Real content."


def test_extract_topics_skips_items_with_no_title():
    topics = [{"templateTopic": False, "title": "", "details": "[]"}]
    assert _extract_topics(topics) == []
