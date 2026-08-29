"""Tests for ai_pipeline/publish.py's already_has_a_story() -- the fix for
the duplicate-meeting-slug bug (AdSense remediation Phase B1, see
db/migrations/034_stories_meeting_id.sql for the full root-cause writeup).
Confirmed live 2026-08-29: 77 real duplicate pairs existed because the old
dedup check only looked at the computed SLUG STRING, which a slug-format
change (the SEO Fas 5 dated-slug rollout) can make look "new" again for a
meeting that already has a published story under a different slug shape.
This test fails exactly the way the old code did if the meeting-id check
is ever removed or bypassed."""
from ai_pipeline.publish import already_has_a_story


def test_a_meeting_already_published_under_the_legacy_slug_is_skipped_for_the_dated_slug():
    # The real live scenario: meeting 11179 was published as "meeting-11179"
    # before the dated-slug rollout. A later run recomputes the slug as
    # "meeting-2026-06-16-11179" for the SAME row -- a slug-string-only
    # check would treat that as new. The real check must not.
    known_meeting_ids = {11179}
    assert already_has_a_story("meeting", 11179, known_meeting_ids) is True


def test_a_genuinely_new_meeting_is_not_skipped():
    known_meeting_ids = {11179}
    assert already_has_a_story("meeting", 99999, known_meeting_ids) is False


def test_empty_known_ids_never_skips():
    assert already_has_a_story("meeting", 11179, set()) is False


def test_other_source_types_are_never_affected_by_this_check():
    # events/alerts don't have this bug class at all (no dated-slug
    # rollout ever touched them) -- this check must be a no-op for them
    # regardless of what's in known_meeting_ids, so it can never introduce
    # a NEW false-positive skip for a type it wasn't built for.
    known_meeting_ids = {42}
    assert already_has_a_story("event", 42, known_meeting_ids) is False
    assert already_has_a_story("alert", 42, known_meeting_ids) is False
    assert already_has_a_story("meeting_followup", 42, known_meeting_ids) is False
