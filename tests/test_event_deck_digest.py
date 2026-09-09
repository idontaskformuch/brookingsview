from ai_pipeline.event_deck_digest import (
    MAX_CHARS, build_grounding_text, check_deck, content_hash, digest_key, rank_events,
    select_marquee, venue_tier_rank,
)

BASE_CFG = {"town_id": "brookings_sd", "state": "South Dakota", "display_name": "Brookings"}


def entry(id_="e1", title="A Show", venue_name="Denny Sanford PREMIER Center", venue_id="KovZpZAJAl7A",
          dist=52, segment="Music", genre="Rock", local_date="2026-12-05", local_time="19:00:00",
          attraction_id=None, price_range_text=None) -> dict:
    member = {
        "id": id_, "title": title, "attraction_id": attraction_id,
        "venue_name": venue_name, "venue_id": venue_id, "venue_distance_miles": dist,
        "segment": segment, "genre": genre,
        "occurs_at": f"{local_date}T00:00:00Z", "local_date": local_date, "local_time": local_time,
        "price_range_text": price_range_text,
    }
    return member


def collapsed(*members) -> dict:
    """A collapse_runs()-shaped entry: the primary member's own fields
    spread directly, plus a `members` list -- mirrors collapse_runs()'s own
    `{**e, "members": [e]}` shape exactly, for tests that don't need to
    call collapse_runs() itself."""
    return {**members[0], "members": list(members)}


class TestVenueTierRank:
    def test_orders_small_medium_large(self):
        assert venue_tier_rank("small") < venue_tier_rank("medium") < venue_tier_rank("large")

    def test_unknown_tier_defaults_to_lowest(self):
        assert venue_tier_rank("nonsense") == venue_tier_rank("small")


class TestRankEvents:
    def test_higher_venue_tier_ranks_first(self):
        # Denny Sanford PREMIER Center = large (brookings_sd VENUE_TIERS_BY_ID),
        # BIGS Sports Bar = small.
        large = collapsed(entry(id_="a", venue_name="Denny Sanford PREMIER Center", venue_id="KovZpZAJAl7A"))
        small = collapsed(entry(id_="b", venue_name="BIGS Sports Bar", venue_id="rZ7HnEZ178s_A"))
        ranked = rank_events([small, large], "brookings_sd")
        assert [e["id"] for e in ranked] == ["a", "b"]

    def test_same_tier_sorts_by_soonest_date(self):
        later = collapsed(entry(id_="later", local_date="2026-12-20"))
        sooner = collapsed(entry(id_="sooner", local_date="2026-12-01"))
        # Both default to the same (unmapped -> small) tier here.
        ranked = rank_events([later, sooner], "brookings_sd")
        assert [e["id"] for e in ranked] == ["sooner", "later"]

    def test_final_tiebreak_is_title(self):
        b = collapsed(entry(id_="b", title="B Show", local_date="2026-12-01"))
        a = collapsed(entry(id_="a", title="A Show", local_date="2026-12-01"))
        ranked = rank_events([b, a], "brookings_sd")
        assert [e["id"] for e in ranked] == ["a", "b"]


class TestSelectMarquee:
    def test_collapses_runs_before_ranking(self):
        a = entry(id_="a", attraction_id="attr1", venue_id="v1")
        b = entry(id_="b", attraction_id="attr1", venue_id="v1")
        marquee = select_marquee([a, b], "brookings_sd", marquee_size=6)
        assert len(marquee) == 1
        assert len(marquee[0]["members"]) == 2

    def test_caps_at_marquee_size(self):
        events = [entry(id_=f"e{i}", local_date="2026-12-01") for i in range(10)]
        marquee = select_marquee(events, "brookings_sd", marquee_size=3)
        assert len(marquee) == 3


class TestDigestKey:
    def test_standalone_event_keyed_by_its_own_id(self):
        e = collapsed(entry(id_="e1", attraction_id=None))
        assert digest_key(e) == "e1"

    def test_collapsed_run_keyed_by_attraction_and_venue_not_by_primary_id(self):
        # Real bug this guards against: the "primary" member's own id isn't
        # stable across two separate live fetches (this script's own fetch
        # vs. the Astro build's independent one) -- see this function's own
        # doc comment. Two entries representing the SAME run but with
        # DIFFERENT primary member ids (as if two separate fetches picked a
        # different date as "first") must still produce the SAME key.
        run_a = collapsed(entry(id_="date-1", attraction_id="attr1", venue_id="v1"))
        run_b = collapsed(entry(id_="date-2", attraction_id="attr1", venue_id="v1"))
        assert digest_key(run_a) == digest_key(run_b)

    def test_different_venues_produce_different_keys_even_with_same_attraction(self):
        a = collapsed(entry(attraction_id="attr1", venue_id="v1"))
        b = collapsed(entry(attraction_id="attr1", venue_id="v2"))
        assert digest_key(a) != digest_key(b)

    def test_falls_back_to_venue_name_when_no_venue_id(self):
        a = collapsed(entry(attraction_id="attr1", venue_id=None, venue_name="The Junkyard"))
        assert digest_key(a) == "attr1::The Junkyard"


class TestBuildGroundingText:
    def test_includes_core_fields(self):
        e = collapsed(entry(title="A Touring Band", venue_name="Denny Sanford PREMIER Center"))
        text = build_grounding_text(e, "brookings_sd")
        assert "A Touring Band" in text
        assert "Denny Sanford PREMIER Center" in text
        assert "large-capacity venue" in text

    def test_includes_price_when_present(self):
        e = collapsed(entry(price_range_text="$25 - $75"))
        text = build_grounding_text(e, "brookings_sd")
        assert "$25 - $75" in text

    def test_omits_price_line_when_absent(self):
        e = collapsed(entry(price_range_text=None))
        text = build_grounding_text(e, "brookings_sd")
        assert "Price range" not in text

    def test_notes_run_size_for_a_multi_date_entry(self):
        e = collapsed(entry(id_="a", local_date="2026-12-01"), entry(id_="b", local_date="2026-12-08"))
        text = build_grounding_text(e, "brookings_sd")
        assert "2 performances" in text


class TestContentHash:
    def test_stable_for_the_same_entry(self):
        e = collapsed(entry())
        assert content_hash(e) == content_hash(e)

    def test_changes_when_price_changes(self):
        a = collapsed(entry(price_range_text="$25"))
        b = collapsed(entry(price_range_text="$50"))
        assert content_hash(a) != content_hash(b)

    def test_changes_when_date_changes(self):
        a = collapsed(entry(local_date="2026-12-01"))
        b = collapsed(entry(local_date="2026-12-15"))
        assert content_hash(a) != content_hash(b)

    def test_unaffected_by_field_order_or_object_identity(self):
        a = collapsed(entry())
        b = collapsed(dict(entry()))
        assert content_hash(a) == content_hash(b)


class TestCheckDeck:
    def test_over_length_is_rejected(self):
        long_text = "A" * (MAX_CHARS + 1)
        passed, violations = check_deck(long_text, "source", BASE_CFG)
        assert not passed
        assert any("over length" in v for v in violations)

    def test_a_name_not_in_source_is_rejected(self):
        passed, _ = check_deck(
            "This is Totally Invented Headliner live at the venue.",
            "source data mentions nothing like that", BASE_CFG,
        )
        assert not passed

    def test_a_price_not_in_source_is_rejected(self):
        passed, _ = check_deck(
            "Tickets run $9999 for this show.",
            "EVENT: A Show\nVenue: Denny Sanford PREMIER Center", BASE_CFG,
        )
        assert not passed

    def test_clean_grounded_sentence_passes(self):
        src = "EVENT: A Show\nVenue: Denny Sanford PREMIER Center (a large-capacity venue), ~52 miles from town"
        passed, violations = check_deck(
            "A Show plays Denny Sanford PREMIER Center, about 52 miles from town.",
            src, BASE_CFG,
        )
        assert passed, violations
