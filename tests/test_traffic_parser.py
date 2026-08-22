"""Regression tests for the FAS 2 traffic_v1.py fixes (see
scrapers/parsers/traffic_v1.py:_road_from_title/_classify_severity) -- the
old "Route \\d+" road regex matched almost nothing against real Caltrans
titles, and `severity` was always written as None despite being an existing
schema column.
"""
from scrapers.parsers.traffic_v1 import _classify_severity, _road_from_title


def test_road_from_directional_route():
    assert _road_from_title("Northbound 215 Off Ramp Full Closure") == "Northbound 215"


def test_road_from_highway_prefix():
    assert _road_from_title("Debris in roadway on I-215") == "I-215"


def test_road_from_legacy_route_word_still_works():
    assert _road_from_title("Route 60 lane closure") == "Route 60"


def test_road_from_named_street():
    assert _road_from_title("Sunnymead Blvd closed for repairs") == "Sunnymead Blvd"


def test_road_returns_none_when_unextractable():
    assert _road_from_title("Traffic advisory in effect") is None


def test_severity_closure_takes_priority():
    assert _classify_severity("lane_closure", "Full Closure on SR-60", None) == "closure"


def test_severity_injury_for_chp_incident():
    assert _classify_severity("chp_incident", "TC with INJ reported", None) == "injury"


def test_severity_injury_keyword_ignored_for_lane_closure():
    # INJ-style keywords only mean something coming from a CHP incident --
    # a lane_closure title would not realistically contain them, but the
    # classifier should still not misfire into "injury" for that type.
    assert _classify_severity("lane_closure", "Routine maintenance", None) == "incident"


def test_severity_defaults_to_incident():
    assert _classify_severity("chp_incident", "Vehicle stopped on shoulder", None) == "incident"
