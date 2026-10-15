"""QA finding #3 (2026-10) backfill -- see scripts/merge_cross_source_event_
duplicates.py's own module docstring. Mock connection/cursor (no real DB),
same convention as tests/test_db_upsert_dedup.py.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

from scripts.merge_cross_source_event_duplicates import find_duplicate_story_groups

UTC = timezone.utc
CENTRAL = ZoneInfo("America/Chicago")

REGISTRY = {
    "sd art museum": {"slug": "south-dakota-art-museum"},
    "south dakota art museum": {"slug": "south-dakota-art-museum"},
}


def _fake_conn(rows):
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn


def _story(slug, title, venue_raw, occurs_at, published_at, body_len):
    return {
        "slug": slug, "title": title, "venue_raw": venue_raw,
        "occurs_at": occurs_at, "published_at": published_at, "body_len": body_len,
    }


def test_two_published_duplicates_collapse_with_richer_body_winning():
    rows = [
        _story("event-305361", "Community Art Day", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC), 400),
        _story("event-282136", "Community Art Day", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 5, tzinfo=UTC), 900),
    ]
    conn = _fake_conn(rows)
    result = find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL)
    assert len(result) == 1
    assert result[0]["winner_slug"] == "event-282136"
    assert result[0]["loser_slugs"] == ["event-305361"]
    assert result[0]["count"] == 2


def test_ties_on_body_length_prefer_earliest_published_at():
    rows = [
        _story("event-a", "Fall Festival", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 5, tzinfo=UTC), 500),
        _story("event-b", "Fall Festival", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC), 500),
    ]
    conn = _fake_conn(rows)
    result = find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL)
    assert result[0]["winner_slug"] == "event-b"  # earlier published_at


def test_the_actual_live_bug_one_missing_venue_still_merges():
    # The real live Brookings case this script exists for: event-282136
    # never captured venue_raw; event-305361 resolves to the Art Museum.
    # Same title+day, same real event -- must merge despite the missing
    # venue on one side.
    rows = [
        _story("event-282136", "Community Art Day", None,
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 6, tzinfo=UTC), 150),
        _story("event-305361", "Community Art Day", "South Dakota Art Museum, 1036 Medary Ave",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 10, 4, tzinfo=UTC), 900),
    ]
    conn = _fake_conn(rows)
    result = find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL)
    assert len(result) == 1
    assert result[0]["winner_slug"] == "event-305361"
    assert result[0]["loser_slugs"] == ["event-282136"]


def test_known_limitation_near_miss_titles_not_grouped():
    rows = [
        _story("event-a", "Community Art Day", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC), 400),
        _story("event-b", "Free Community Art Day", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC), 400),
    ]
    conn = _fake_conn(rows)
    result = find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL)
    assert result == []


def test_singleton_titles_produce_no_groups():
    rows = [
        _story("event-a", "Unique Event", "SD Art Museum",
               datetime(2026, 10, 17, 15, 0, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC), 400),
    ]
    conn = _fake_conn(rows)
    assert find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL) == []


def test_no_rows_returns_no_groups():
    conn = _fake_conn([])
    assert find_duplicate_story_groups(conn, "brookings_sd", REGISTRY, CENTRAL) == []
