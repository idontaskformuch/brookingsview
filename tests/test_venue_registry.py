"""Regression tests for Event JSON-LD venue resolution (see
ai_pipeline/venue_registry.py and NEEDS-HUMAN-REVIEW.md, "Event JSON-LD
venue resolution & emission rules"). Pure logic only -- normalize_venue(),
resolve_venue(), is_virtual(), has_resolved_address() take plain dicts/
strings, no DB connection.
"""
from ai_pipeline.venue_registry import (
    has_resolved_address, is_virtual, normalize_venue, resolve_venue,
)

MAIN_LIBRARY = {
    "slug": "main-library", "name": "Moreno Valley Public Library — Main Branch",
    "street_address": "25480 Alessandro Blvd", "postal_code": "92553",
}
CITY_HALL_NO_ADDRESS = {
    "slug": "city-hall", "name": "Moreno Valley City Hall",
    "street_address": None, "postal_code": None,
}
REGISTRY = {
    "main library": MAIN_LIBRARY,
    "main branch moreno valley public library": MAIN_LIBRARY,
    "moreno valley city hall": CITY_HALL_NO_ADDRESS,
}


def test_normalize_strips_address_tail_after_first_comma():
    # Real scraped shape: "Name,Street, City, ST ZIP, USA"
    raw = "Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA"
    assert normalize_venue(raw) == "main library"


def test_normalize_is_case_and_whitespace_insensitive():
    assert normalize_venue("  MAIN   Library  ") == "main library"


def test_normalize_none_or_blank_returns_none():
    assert normalize_venue(None) is None
    assert normalize_venue("   ") is None


def test_normalize_strips_label_prefix():
    assert normalize_venue("MAIN LIBRARY: Community Room, 25480 Alessandro Blvd") == "community room"


def test_resolve_matches_exact_alias():
    raw = "Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA"
    assert resolve_venue(REGISTRY, raw) == MAIN_LIBRARY


def test_resolve_matches_alternate_alias_for_same_facility():
    raw = "Main Branch Moreno Valley Public Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA"
    assert resolve_venue(REGISTRY, raw) == MAIN_LIBRARY


def test_resolve_returns_none_for_unknown_venue():
    # A real observed case: a third-party host with a real street address in
    # the source string, but not in our curated (hand-verified) registry --
    # must NOT resolve just because it looks address-shaped.
    raw = "Building Up Lives Foundation,23185 Hemlock Ave suite a, Moreno Valley, CA 92557, USA"
    assert resolve_venue(REGISTRY, raw) is None


def test_resolve_returns_none_for_garbage_venue_string():
    # Real observed case: NWS weather-zone lists leaking into the venue
    # field from an unrelated source -- must never resolve to a facility.
    raw = "Coachella Valley; San Diego County Deserts; San Gorgonio Pass Near Banning"
    assert resolve_venue(REGISTRY, raw) is None


def test_is_virtual_detects_known_keywords():
    assert is_virtual("Zoom Meeting Room") is True
    assert is_virtual(None, "Join us for this online storytime via Zoom") is True


def test_is_virtual_false_for_physical_venue():
    assert is_virtual("Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA") is False


def test_has_resolved_address_requires_both_fields():
    assert has_resolved_address(MAIN_LIBRARY) is True
    assert has_resolved_address(CITY_HALL_NO_ADDRESS) is False
    assert has_resolved_address(None) is False
