"""Tests for scripts/check_deployed_content.py's pure logic -- the
network/DB-touching orchestration (check_homepage_freshness,
check_signature_section) isn't unit tested directly, same convention as
the rest of this codebase (test the extracted pure function, not the I/O
wrapper around it).
"""
from datetime import datetime, timedelta, timezone

from scripts.check_deployed_content import (
    SIGNATURE_SECTIONS,
    SITE_URLS,
    extract_story_slugs,
    is_stale,
)


def test_extract_story_slugs_finds_all_distinct_links():
    html = '<a href="/s/meeting-2026-08-04/">x</a><a href="/s/recipe-2026-08-27/">y</a>'
    assert extract_story_slugs(html) == ["meeting-2026-08-04", "recipe-2026-08-27"]


def test_extract_story_slugs_dedupes():
    html = '<a href="/s/foo/">a</a><a href="/s/foo/">b again</a>'
    assert extract_story_slugs(html) == ["foo"]


def test_extract_story_slugs_ignores_non_story_links():
    html = '<a href="/university/">x</a><a href="/this-week/2026-w35/">y</a>'
    assert extract_story_slugs(html) == []


def test_extract_story_slugs_empty_page():
    assert extract_story_slugs("<html><body>nothing here</body></html>") == []


def test_is_stale_none_counts_as_stale():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert is_stale(None, 2, now) is True


def test_is_stale_within_window_is_fresh():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=1)
    assert is_stale(published, 2, now) is False


def test_is_stale_exactly_on_boundary_is_still_fresh():
    # strict "<" in is_stale -- exactly `freshness_days` old still counts
    # as fresh, only OLDER than the window is stale.
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=2)
    assert is_stale(published, 2, now) is False


def test_is_stale_older_than_window_is_stale():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=10)
    assert is_stale(published, 2, now) is True


def test_all_three_towns_have_a_site_url_and_signature_section():
    for town_id in ("brookings_sd", "moreno_valley_ca", "broomfield_co"):
        assert town_id in SITE_URLS
        assert SITE_URLS[town_id].startswith("https://")
        assert town_id in SIGNATURE_SECTIONS
        assert SIGNATURE_SECTIONS[town_id]["path"].startswith("/")
