"""Regression tests for content/local_context.py's "Columns thematic
repetition" fix (see NEEDS-HUMAN-REVIEW.md) -- the real bug: a recurring
civic quorum notice (Downtown at Sundown, republished nearly verbatim every
week all summer) dominated the 15-item pool recent_local_stories() hands to
the model, so the model kept picking the same available "angle" day after
day. No DB, no network -- pure function tests against fixtures shaped like
the real rows that caused this (see NEEDS-HUMAN-REVIEW.md for the actual
meeting-1313/1314/1315 etc. slugs)."""
from content.local_context import _collapse_recurring, _topic_key, build_local_input

QUORUM_NOTICE_1 = {
    "title": "City Council — Thu, Aug 13, 2026",
    "body": "Downtown at Sundown runs Thursday, August 13, from 5:30 to 9 p.m. "
            "on Main Avenue in Downtown Brookings. At least four City Council "
            "members may attend, though no official city business will be "
            "conducted.",
}
QUORUM_NOTICE_2 = {
    "title": "City Council — Thu, Aug 20, 2026",
    "body": "Downtown at Sundown happens Thursday, August 20, from 5:30 to "
            "9:00 p.m. on Main Avenue in Downtown Brookings. At least four "
            "City Council members may attend, though no official city "
            "business will be conducted.",
}
QUORUM_NOTICE_3 = {
    "title": "City Council — Fri, Aug 21, 2026",
    "body": "A quorum notice has been issued for August 21: at least four "
            "Brookings City Council members may be present at the Meet "
            "State 2026 event.",
}
REAL_MEETING = {
    "title": "City Council — Thu, Jul 30, 2026",
    "body": "The council held a public hearing on leasing city property to "
            "RTI, LLC, and voted to annex two outlots into city limits.",
}
REAL_EVENT = {
    "title": "Brookings Farmers Market",
    "body": "The farmers market runs Saturdays at 9 a.m. on the 300 block "
            "of 6th Ave, with free family yoga before the market opens.",
}


def test_topic_key_recognizes_quorum_notice_variants():
    assert _topic_key(QUORUM_NOTICE_1) == "quorum_notice"
    assert _topic_key(QUORUM_NOTICE_2) == "quorum_notice"
    assert _topic_key(QUORUM_NOTICE_3) == "quorum_notice"


def test_topic_key_none_for_real_civic_business():
    assert _topic_key(REAL_MEETING) is None
    assert _topic_key(REAL_EVENT) is None


def test_collapse_recurring_keeps_only_one_quorum_notice():
    stories = [QUORUM_NOTICE_1, QUORUM_NOTICE_2, QUORUM_NOTICE_3, REAL_MEETING, REAL_EVENT]
    result = _collapse_recurring(stories)
    quorum_count = sum(1 for s in result if _topic_key(s) == "quorum_notice")
    assert quorum_count == 1
    assert len(result) == 3  # 1 quorum notice (deduped) + 2 real stories


def test_collapse_recurring_keeps_the_most_recent_instance():
    # DESC published_at order means QUORUM_NOTICE_1 (index 0) is "most
    # recent" -- collapse must keep the first one seen, not an arbitrary one.
    stories = [QUORUM_NOTICE_1, QUORUM_NOTICE_2, QUORUM_NOTICE_3]
    result = _collapse_recurring(stories)
    assert result == [QUORUM_NOTICE_1]


def test_collapse_recurring_does_not_touch_real_stories():
    stories = [REAL_MEETING, REAL_EVENT]
    assert _collapse_recurring(stories) == stories


def test_build_local_input_includes_recent_titles_section():
    text = build_local_input([REAL_MEETING], "Brookings", recent_titles=["A Quorum on Main Avenue"])
    assert "REDAN TÄCKT" in text
    assert "A Quorum on Main Avenue" in text


def test_build_local_input_omits_recent_titles_section_when_empty():
    text = build_local_input([REAL_MEETING], "Brookings", recent_titles=[])
    assert "REDAN TÄCKT" not in text


def test_build_local_input_omits_recent_titles_section_when_none():
    text = build_local_input([REAL_MEETING], "Brookings")
    assert "REDAN TÄCKT" not in text


def test_build_local_input_none_when_no_stories_even_with_titles():
    assert build_local_input([], "Brookings", recent_titles=["Something"]) is None
