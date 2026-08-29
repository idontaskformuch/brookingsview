"""Regression tests for ai_pipeline/sdsu_weekly_digest.py's pure logic (see
NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild", A.2). No DB, no network
-- gather_events()/gather_academic_dates() are exercised live via --dry-run,
same as this project's other digest scripts."""
from datetime import datetime
from zoneinfo import ZoneInfo

from ai_pipeline.sdsu_weekly_digest import (
    _collapse_simultaneous, _dedupe_exact_repeats, build_grounding_text, build_prompt,
    content_hash, template_fallback,
)

CT = ZoneInfo("America/Chicago")
CFG = {"display_name": "Test Town", "state": "Test State"}


# --- AdSense "low value content" remediation, Phase A6: roundups must read
# as synthesis, not a re-listing ---------------------------------------------

def test_build_prompt_requests_why_the_lead_item_stands_out():
    prompt = build_prompt(CFG, "August 24")
    assert "why it stands out this week" in prompt
    assert "never invent significance" in prompt


def test_build_prompt_still_bans_describing_outcomes():
    prompt = build_prompt(CFG, "August 24")
    assert "do not describe" in prompt
    assert "outcomes, scores, or how anything went" in prompt


def _event(title, hour, cat="Special Events", location=None, teaser=None):
    return {
        "id": hash(title) % 10_000,
        "title": title,
        "teaser": teaser,
        "location": location,
        "starts_at": datetime(2026, 8, 23, hour, 0, tzinfo=CT),
        "primary_category": cat,
    }


def test_collapse_leaves_small_groups_individual():
    events = [_event("A", 15), _event("B", 15)]
    result = _collapse_simultaneous(events)
    assert len(result) == 2
    assert all(isinstance(r, dict) for r in result)


def test_collapse_groups_three_or_more_simultaneous():
    events = [_event("AHSS Welcome", 15), _event("CAFES Welcome", 15),
              _event("EHS Welcome", 15), _event("NS Welcome", 15)]
    result = _collapse_simultaneous(events)
    assert len(result) == 1
    assert isinstance(result[0], list)
    assert len(result[0]) == 4


def test_collapse_does_not_merge_different_times():
    events = [_event("A", 15), _event("B", 15), _event("C", 15), _event("D", 19)]
    result = _collapse_simultaneous(events)
    # the 3 at 15:00 collapse, the 1 at 19:00 stays individual
    assert len(result) == 2
    assert isinstance(result[0], list) and len(result[0]) == 3
    assert isinstance(result[1], dict)


def test_grounding_text_excludes_nothing_extra_and_collapses_series():
    events = [_event("AHSS Welcome", 15), _event("CAFES Welcome", 15), _event("EHS Welcome", 15)]
    text = build_grounding_text(events, "August 23-29", CT)
    assert "collapsed item" in text
    assert "3 events at the same time" in text


def test_grounding_text_includes_academic_dates_and_leads_instruction():
    academic_dates = [{"label": "Fall classes begin", "category": "term_start",
                        "starts_on": "2026-08-24", "ends_on": None}]
    text = build_grounding_text([], "August 23-29", CT, academic_dates)
    assert "SIGNIFICANT ACADEMIC DATES" in text
    assert "Fall classes begin" in text


def test_grounding_text_no_events_no_academic_dates_says_so():
    text = build_grounding_text([], "August 23-29", CT)
    assert "No tracked SDSU events" in text


def test_template_fallback_never_lists_more_than_one_line_per_cluster():
    events = [_event("A", 15), _event("B", 15), _event("C", 15)]
    text = template_fallback(events, "August 23-29", CT)
    assert text.count(" at ") <= 2  # one collapsed cluster line + the "events for the week" header shape


def test_template_fallback_includes_academic_dates():
    academic_dates = [{"label": "Fall classes begin", "starts_on": "2026-08-24"}]
    text = template_fallback([], "August 23-29", CT, academic_dates)
    assert "Fall classes begin" in text


def test_content_hash_changes_when_academic_dates_change():
    a = content_hash([], [])
    b = content_hash([], [{"label": "Fall classes begin", "starts_on": "2026-08-24"}])
    assert a != b


def test_dedupe_exact_repeats_drops_same_title_same_time():
    # Real observed case: "Playfair - The Ultimate Icebreaker" listed twice
    # under two different SDSU calendar URLs, same title, same starts_at.
    a = _event("Playfair - The Ultimate Icebreaker", 10, location="Dana J. Dykhouse Stadium")
    b = dict(a, id=a["id"] + 1)  # different row id, same title+time+location
    result = _dedupe_exact_repeats([a, b])
    assert len(result) == 1


def test_dedupe_exact_repeats_keeps_same_title_different_time():
    a = _event("Indian Students' Association Celebration", 10)
    b = _event("Indian Students' Association Celebration", 10)
    b["starts_at"] = b["starts_at"].replace(day=24)  # a genuinely different day
    result = _dedupe_exact_repeats([a, b])
    assert len(result) == 2


def test_content_hash_stable_regardless_of_order():
    events = [_event("A", 15), _event("B", 16)]
    a = content_hash(events, [])
    b = content_hash(list(reversed(events)), [])
    assert a == b
