from datetime import datetime
from zoneinfo import ZoneInfo

from ai_pipeline import guardrails
from ai_pipeline.whats_on_intro import (
    MAX_CHARS, build_grounding_text, check_intro, collapse_runs, content_hash,
    filter_to_week, is_non_event_listing, is_sports_event, venue_tier_for,
    week_bounds,
)

TZ = ZoneInfo("America/Chicago")

BASE_CFG = {"town_id": "brookings_sd", "state": "South Dakota", "display_name": "Brookings"}


def raw_event(**overrides) -> dict:
    base = {
        "id": "Z7r9jZ1A70S3p",
        "name": "A Touring Band Live",
        "classifications": [{"primary": True, "segment": {"name": "Music"}}],
        "_embedded": {"venues": [{"id": "v1", "name": "Denny Sanford PREMIER Center", "distance": 52}]},
        "dates": {"start": {"localDate": "2026-12-05", "localTime": "19:00:00", "dateTime": "2026-12-06T01:00:00Z"}},
    }
    base.update(overrides)
    return base


def entry(id_="e1", title="A Show", venue_name="Denny Sanford PREMIER Center", venue_id="KovZpZAJAl7A",
          dist=52, segment="Music", genre="Rock", local_date="2026-12-05", local_time="19:00:00",
          attraction_id=None) -> dict:
    member = {
        "id": id_, "title": title, "attraction_id": attraction_id,
        "venue_name": venue_name, "venue_id": venue_id, "venue_distance_miles": dist,
        "segment": segment, "genre": genre,
        "occurs_at": f"{local_date}T00:00:00Z", "local_date": local_date, "local_time": local_time,
    }
    return member


class TestSportsAndUpsellFilters:
    def test_is_sports_event_true_for_sports_segment(self):
        assert is_sports_event(raw_event(classifications=[{"primary": True, "segment": {"name": "Sports"}}]))

    def test_is_sports_event_false_for_music(self):
        assert not is_sports_event(raw_event())

    def test_is_sports_event_false_when_classifications_absent(self):
        assert not is_sports_event(raw_event(classifications=None))

    def test_is_non_event_listing_true_for_upsell_type(self):
        raw = raw_event(classifications=[{"primary": True, "segment": {"name": "Misc"}, "type": {"name": "Upsell"}}])
        assert is_non_event_listing(raw)

    def test_is_non_event_listing_false_for_undefined_type(self):
        raw = raw_event(classifications=[{"primary": True, "segment": {"name": "Music"}, "type": {"name": "Undefined"}}])
        assert not is_non_event_listing(raw)


class TestWeekBounds:
    def test_monday_to_next_monday(self):
        # 2026-09-09 is a Wednesday
        now = datetime(2026, 9, 9, 12, 0, tzinfo=TZ)
        monday, end, iso_year, iso_week = week_bounds(TZ, now)
        assert monday.weekday() == 0
        assert monday.date().isoformat() == "2026-09-07"
        assert end.date().isoformat() == "2026-09-14"
        assert (iso_year, iso_week) == (2026, 37)

    def test_a_monday_itself_is_its_own_week_start(self):
        now = datetime(2026, 9, 7, 0, 0, tzinfo=TZ)
        monday, _, _, _ = week_bounds(TZ, now)
        assert monday.date().isoformat() == "2026-09-07"


class TestFilterToWeek:
    def test_keeps_events_within_bounds_excludes_outside(self):
        monday = datetime(2026, 9, 7, 0, 0, tzinfo=TZ)
        end = datetime(2026, 9, 14, 0, 0, tzinfo=TZ)
        inside = entry(id_="in")
        inside["occurs_at"] = "2026-09-09T18:00:00Z"
        outside = entry(id_="out")
        outside["occurs_at"] = "2026-09-20T18:00:00Z"
        no_date = entry(id_="nodate")
        no_date["occurs_at"] = None
        kept = filter_to_week([inside, outside, no_date], monday, end)
        assert [e["id"] for e in kept] == ["in"]


class TestCollapseRuns:
    def test_collapses_same_attraction_and_venue(self):
        a = entry(id_="a", attraction_id="attr1", venue_id="v1")
        b = entry(id_="b", attraction_id="attr1", venue_id="v1")
        entries = collapse_runs([a, b])
        assert len(entries) == 1
        assert len(entries[0]["members"]) == 2

    def test_does_not_collapse_without_attraction_id(self):
        a = entry(id_="a", attraction_id=None)
        b = entry(id_="b", attraction_id=None)
        entries = collapse_runs([a, b])
        assert len(entries) == 2

    def test_does_not_collapse_same_attraction_different_venue(self):
        a = entry(id_="a", attraction_id="attr1", venue_id="v1")
        b = entry(id_="b", attraction_id="attr1", venue_id="v2")
        entries = collapse_runs([a, b])
        assert len(entries) == 2

    def test_empty_list(self):
        assert collapse_runs([]) == []


class TestVenueTierFor:
    def test_resolves_by_id_first(self):
        assert venue_tier_for("brookings_sd", "Some Other Name", "KovZpZAJAl7A") == "large"

    def test_falls_back_to_name(self):
        assert venue_tier_for("brookings_sd", "BIGS Sports Bar", None) == "small"

    def test_defaults_when_uncurated(self):
        assert venue_tier_for("brookings_sd", "A Brand New Venue", None) == "small"


class TestBuildGroundingText:
    def test_includes_run_count_for_a_collapsed_run(self):
        a = entry(id_="a", attraction_id="attr1", venue_id="v1", local_date="2026-12-05")
        b = entry(id_="b", attraction_id="attr1", venue_id="v1", local_date="2026-12-06")
        entries = collapse_runs([a, b])
        text, weekdays = build_grounding_text(entries, "brookings_sd", TZ)
        assert "2 performances" in text
        assert weekdays == {"Saturday", "Sunday"}

    def test_single_date_has_no_performance_count(self):
        entries = collapse_runs([entry(id_="a")])
        text, _ = build_grounding_text(entries, "brookings_sd", TZ)
        assert "performances" not in text

    def test_vague_classification_shows_generically(self):
        entries = collapse_runs([entry(id_="a", segment="Miscellaneous", genre=None)])
        text, _ = build_grounding_text(entries, "brookings_sd", TZ)
        assert "Classification: Miscellaneous" in text


class TestContentHash:
    def test_deterministic(self):
        entries = collapse_runs([entry(id_="a"), entry(id_="b")])
        assert content_hash(entries) == content_hash(entries)

    def test_changes_when_events_change(self):
        h1 = content_hash(collapse_runs([entry(id_="a")]))
        h2 = content_hash(collapse_runs([entry(id_="a"), entry(id_="b")]))
        assert h1 != h2


class TestCheckWeekdayConsistency:
    def test_passes_when_weekday_is_real(self):
        result = guardrails.check_weekday_consistency("It happens Friday night.", {"Friday"})
        assert result.passed

    def test_rejects_wrong_weekday(self):
        result = guardrails.check_weekday_consistency("It happens Friday night.", {"Saturday"})
        assert not result.passed
        assert "Friday" in result.violations[0]

    def test_no_weekday_mentioned_always_passes(self):
        result = guardrails.check_weekday_consistency("Several shows are happening this week.", set())
        assert result.passed


class TestCheckIntro:
    def test_over_length_is_rejected(self):
        long_text = "A" * (MAX_CHARS + 1)
        passed, violations = check_intro(long_text, "source", BASE_CFG, set(), [])
        assert not passed
        assert any("over length" in v for v in violations)

    def test_a_name_not_in_source_is_rejected(self):
        passed, violations = check_intro(
            "This week features Totally Invented Headliner at the venue.",
            "source data mentions nothing like that", BASE_CFG, set(), [],
        )
        assert not passed

    def test_wrong_weekday_is_rejected(self):
        passed, violations = check_intro(
            "The show is Saturday night.", "the show is Friday", BASE_CFG, {"Friday"}, [],
        )
        assert not passed
        assert any("weekday" in v for v in violations)

    def test_clean_short_grounded_text_passes(self):
        passed, violations = check_intro(
            "Three shows play this week within 50 miles of town.",
            "Three shows play this week within 50 miles of town.", BASE_CFG, set(), [],
        )
        assert passed
        assert violations == []
