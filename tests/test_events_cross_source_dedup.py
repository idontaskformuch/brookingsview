"""QA finding #3 (2026-10): the SAME real event, scraped via two different
source paths, each landed as its own `events` row and got published as a
separate story -- confirmed live triple-rendered on Brookings' homepage for
one real Saturday event ("Community Art Day", three `source` values, see
.claude/qa-audit-2026-10.md finding #3). dedupe_cross_source_events() in
ai_pipeline/publish.py closes this before story generation.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ai_pipeline.publish import dedupe_cross_source_events

UTC = timezone.utc
CENTRAL = ZoneInfo("America/Chicago")

ART_MUSEUM_REGISTRY = {
    "sd art museum": {"slug": "south-dakota-art-museum"},
    "south dakota art museum": {"slug": "south-dakota-art-museum"},
}


def _row(id_, title, source, venue=None, description=None, starts_at=None):
    return {
        "id": id_, "title": title, "source": source, "venue": venue,
        "raw_data": {"description": description} if description else {},
        "starts_at": starts_at or datetime(2026, 10, 17, 15, 0, tzinfo=UTC),
    }


def test_two_sources_same_title_and_resolved_venue_collapse_to_one():
    # The live Brookings case: same real event, two sources phrasing the
    # venue differently, both of which resolve to the SAME registered
    # facility via the alias registry.
    rows = [
        _row(305361, "Community Art Day", "visitbrookingssd", venue="SD Art Museum"),
        _row(282136, "Community Art Day", "chamber_business", venue="South Dakota Art Museum",
             description="A hands-on art day for all ages."),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 1


def test_different_unresolved_venue_text_never_groups_even_for_the_same_title_day():
    # "Unknown Place" and "SD Art Museum" don't share a venue identity
    # (one resolves, one doesn't, and they're different raw text either
    # way) -- this is the same conservative "never guess" principle as
    # test_same_title_and_day_but_different_unresolved_venues_stay_separate
    # below, just with one side resolvable this time.
    rows = [
        _row(1, "Fall Festival", "source_a", venue="Unknown Place"),
        _row(2, "Fall Festival", "source_b", venue="SD Art Museum"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 2


def test_winner_prefers_description_when_venue_resolution_is_tied():
    rows = [
        _row(1, "Fall Festival", "source_a", venue="SD Art Museum"),
        _row(2, "Fall Festival", "source_b", venue="SD Art Museum", description="Live music and food trucks."),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 1
    assert result[0]["id"] == 2


def test_winner_prefers_lowest_id_as_final_deterministic_tiebreak():
    rows = [
        _row(305361, "Community Art Day", "a", venue="SD Art Museum"),
        _row(282136, "Community Art Day", "b", venue="SD Art Museum"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert result[0]["id"] == 282136


def test_rerun_always_picks_the_same_winner():
    rows = [
        _row(305361, "Community Art Day", "a", venue="SD Art Museum"),
        _row(282136, "Community Art Day", "b", venue="SD Art Museum"),
    ]
    first = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)[0]["id"]
    second = dedupe_cross_source_events(list(reversed(rows)), CENTRAL, ART_MUSEUM_REGISTRY)[0]["id"]
    assert first == second


def test_same_title_different_real_days_stay_separate():
    rows = [
        _row(1, "Trivia Night", "a", venue="SD Art Museum", starts_at=datetime(2026, 10, 17, 19, 0, tzinfo=UTC)),
        _row(2, "Trivia Night", "b", venue="SD Art Museum", starts_at=datetime(2026, 10, 24, 19, 0, tzinfo=UTC)),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 2


def test_same_title_and_day_but_different_unresolved_venues_stay_separate():
    # Conservative design: two unresolved venue strings are never assumed
    # to be the same real place just because the text differs -- only an
    # EXACT match (post-normalize_venue) or a shared registry resolution
    # groups rows together.
    rows = [
        _row(1, "Trivia Night", "a", venue="The Pub Downtown"),
        _row(2, "Trivia Night", "b", venue="Some Other Bar"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 2


def test_one_source_missing_venue_still_merges_with_a_named_one():
    # The ACTUAL live Brookings bug (found testing this against production,
    # 2026-10-15): event-282136 (GrowthZone mirror) never captured venue_raw
    # at all; event-305361 (visitbrookingssd.com) resolves cleanly to South
    # Dakota Art Museum. Same exact title+day, same real event -- a missing
    # venue on one side must not block the merge just because it isn't an
    # EXACT match for the other side's resolved venue.
    rows = [
        _row(282136, "Community Art Day", "chamber_business", venue=None),
        _row(305361, "Community Art Day", "visitbrookingssd", venue="SD Art Museum"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 1


def test_two_distinct_named_venues_in_the_same_title_day_bucket_never_guessed():
    # A genuine conflict (not just one side missing data) -- two
    # DIFFERENT real, resolved venues sharing a title+day. Could be two
    # real different events; never merged, and the venue-less row (if any)
    # doesn't get silently assigned to either side either.
    rows = [
        _row(1, "Trivia Night", "a", venue="SD Art Museum"),
        _row(2, "Trivia Night", "b", venue="Downtown Main Avenue"),
        _row(3, "Trivia Night", "c", venue=None),
    ]
    registry = {**ART_MUSEUM_REGISTRY, "downtown main avenue": {"slug": "downtown-main-avenue"}}
    result = dedupe_cross_source_events(rows, CENTRAL, registry)
    assert len(result) == 3


def test_no_venue_anywhere_falls_back_to_title_and_day_alone():
    rows = [
        _row(1, "Community Potluck", "a", venue=None),
        _row(2, "Community Potluck", "b", venue=None, description="Bring a dish to share."),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 1
    assert result[0]["id"] == 2  # the one with a description wins


def test_known_limitation_near_miss_titles_are_not_caught():
    # "Free Community Art Day" vs "Community Art Day" -- the real third
    # row from the live triple-duplicate case. Documented, accepted
    # limitation: exact-title match only, no fuzzy matching.
    rows = [
        _row(1, "Community Art Day", "a", venue="SD Art Museum"),
        _row(2, "Free Community Art Day", "b", venue="SD Art Museum"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 2


def test_unrelated_events_are_never_merged():
    rows = [
        _row(1, "Community Art Day", "a", venue="SD Art Museum"),
        _row(2, "Farmers Market", "b", venue="Downtown Main Avenue"),
    ]
    result = dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY)
    assert len(result) == 2


def test_empty_input_returns_empty():
    assert dedupe_cross_source_events([], CENTRAL, {}) == []


def test_single_row_passes_through_unchanged():
    rows = [_row(1, "Solo Event", "a", venue="SD Art Museum")]
    assert dedupe_cross_source_events(rows, CENTRAL, ART_MUSEUM_REGISTRY) == rows
