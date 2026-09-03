"""Regression tests for validation/record_consistency.py (Phase 0 check 4)."""
from validation.record_consistency import check_record_consistency, extract_entities

CFG = {"town_id": "brookings_sd"}

# A meeting record naming two distinct places -- the meeting room itself
# (AgendaLink's raw_data->room shape, see ai_pipeline/publish.py's
# venue_raw follow-up) plus a separate accessibility-accommodations contact
# for a different office, a genuinely common shape in real agenda packets.
TWO_VENUE_RECORD = {
    "title": "City Council", "meeting_date": "2026-09-10",
    "raw_data": {
        "room": {"name": "City Hall", "address": "123 Main Ave", "phone": "605-555-1111"},
    },
    "accessibility_contact": {"name": "County Annex", "phone": "605-555-9999"},
}

ONE_VENUE_RECORD = {
    "title": "Library Board", "venue": "Brookings Public Library",
    "address": "515 3rd St", "phone": "605-555-2222",
}


def test_extract_entities_finds_both_nested_and_flat_places():
    entities = extract_entities(TWO_VENUE_RECORD)
    names = {e["name"] for e in entities}
    assert "City Hall" in names
    assert "County Annex" in names


def test_single_venue_record_always_passes():
    # Nothing to cross-check against with only one named place -- this is
    # the overwhelming majority case and must never false-positive.
    text = "The library board meets to discuss the summer reading program."
    result = check_record_consistency(text, {"venue": "Brookings Public Library", "phone": "605-555-2222"},
                                       ONE_VENUE_RECORD, CFG)
    assert result.passed


def test_matching_venue_and_phone_passes():
    meta = {"venue": "City Hall", "phone": "605-555-1111"}
    text = "The council meets at City Hall."
    result = check_record_consistency(text, meta, TWO_VENUE_RECORD, CFG)
    assert result.passed


def test_mismatched_phone_for_named_venue_fails():
    # Names City Hall but states the County Annex's phone number -- the
    # exact fabrication-by-mixing risk this check exists to catch.
    meta = {"venue": "City Hall", "phone": "605-555-9999"}
    text = "The council meets at City Hall."
    result = check_record_consistency(text, meta, TWO_VENUE_RECORD, CFG)
    assert not result.passed
    assert any("605-555-9999" in v for v in result.violations)


def test_mismatched_address_for_named_venue_fails():
    meta = None
    text = "The council meets at City Hall, located at 123 Main Ave."
    other_venue_record = dict(TWO_VENUE_RECORD)
    other_venue_record["raw_data"] = {
        "room": {"name": "County Annex", "address": "123 Main Ave", "phone": "605-555-9999"},
    }
    other_venue_record["accessibility_contact"] = {"name": "City Hall", "phone": "605-555-1111"}
    result = check_record_consistency(text, meta, other_venue_record, CFG)
    assert not result.passed


def test_no_phone_or_address_stated_always_passes():
    meta = {"venue": "City Hall"}
    text = "The council meets at City Hall to vote on the ordinance."
    result = check_record_consistency(text, meta, TWO_VENUE_RECORD, CFG)
    assert result.passed
