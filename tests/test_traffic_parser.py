"""Regression tests for the FAS 2 traffic_v1.py fixes (see
scrapers/parsers/traffic_v1.py:_road_from_title/_classify_severity) -- the
old "Route \\d+" road regex matched almost nothing against real Caltrans
titles, and `severity` was always written as None despite being an existing
schema column.
"""
from scrapers.parsers.traffic_v1 import TrafficParser, _classify_severity, _dedupe_fsp_companions, _road_from_title


def _lane_closure_placemark(closure_id: str, log_number: str, lat: str = "34.062862", lon: str = "-117.180347",
                             end: str = "3:30pm Sep 9, 2026") -> str:
    """Minimal real-shaped KML placemark -- enough of the actual structure
    for _parse_kml's selectors (.iw-title/.iw-text) and _CLOSURE_ID_RE to
    fire, without the rest of a real Caltrans response."""
    return f"""
    <Placemark>
      <description><![CDATA[
        <div class="iw-title">Eastbound / Westbound 38 Lane Closure</div>
        <div class="iw-text">At Colton Ave / 1 of 2 general purpose lanes closed
        Due to Roadway Excavation / Expected to end at {end}</div>
        Closure ID: {closure_id}, Log Number: {log_number}
      ]]></description>
      <Point><coordinates>{lon},{lat},0</coordinates></Point>
    </Placemark>
    """


def _make_parser() -> TrafficParser:
    return TrafficParser(
        cfg={"town_id": "moreno_valley_ca", "coordinates": {"lat": 33.94, "lon": -117.23}},
        source_cfg={"source": "caltrans_quickmap", "bbox": [30.0, 40.0, -120.0, -110.0]},
    )


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


def _row(external_id: str, lat: float = 34.045381, lon: float = -117.310832) -> dict:
    return {"external_incident_id": external_id, "lat": lat, "lon": lon}


class TestDedupeFspCompanions:
    """Live incident, 2026-09-10: '260902IN0210' and '260902INFSP0087'
    shared the exact same coordinates and overlapping description text --
    a CHP incident and its Freeway Service Patrol companion record, not
    two real incidents. See _dedupe_fsp_companions' own docstring."""

    def test_keeps_the_primary_chp_record_over_its_fsp_companion(self):
        rows = [_row("260902IN0210"), _row("260902INFSP0087")]
        result = _dedupe_fsp_companions(rows)
        assert len(result) == 1
        assert result[0]["external_incident_id"] == "260902IN0210"

    def test_order_of_primary_vs_fsp_in_the_feed_does_not_matter(self):
        rows = [_row("260902INFSP0087"), _row("260902IN0210")]
        result = _dedupe_fsp_companions(rows)
        assert len(result) == 1
        assert result[0]["external_incident_id"] == "260902IN0210"

    def test_keeps_an_fsp_only_record_when_no_primary_exists_at_that_point(self):
        rows = [_row("260902INFSP0087")]
        assert _dedupe_fsp_companions(rows) == rows

    def test_does_not_merge_two_distinct_incidents_at_different_coordinates(self):
        rows = [_row("260909IN0696", lat=34.0, lon=-117.0), _row("260909IN0739", lat=34.1, lon=-117.1)]
        result = _dedupe_fsp_companions(rows)
        assert len(result) == 2

    def test_empty_list(self):
        assert _dedupe_fsp_companions([]) == []


class TestLaneClosureExternalId:
    """Live incident, 2026-09-10: a single recurring lane closure
    ("C38BA") produced 27 separate DB rows over two weeks because the old
    external_id combined Closure ID with Caltrans' own "Log Number" --
    which turned out to be a revision counter that increments every time
    the SAME closure record is re-logged (including routine daily
    re-affirmation of a still-ongoing closure), not a stable secondary
    key. See traffic_v1.py's own comment at the fix site."""

    def test_same_closure_different_log_numbers_now_produce_the_same_external_id(self):
        kml = (
            _lane_closure_placemark("C38BA", "22", end="3:30pm Sep 1, 2026")
            + _lane_closure_placemark("C38BA", "21", end="3:30pm Aug 31, 2026")
        )
        rows = _make_parser()._parse_kml(kml, "lane_closure")
        assert len(rows) == 2
        assert rows[0]["external_incident_id"] == rows[1]["external_incident_id"]

    def test_same_closure_id_at_different_coordinates_stays_distinct(self):
        # A single Closure ID can legitimately cover several physical
        # points along one corridor (confirmed live: "C38BA" spanned 4
        # different lat/lon pairs) -- these must NOT collapse into one row.
        kml = (
            _lane_closure_placemark("C38BA", "7", lat="34.061322", lon="-117.182517")
            + _lane_closure_placemark("C38BA", "4", lat="34.061805", lon="-117.182529")
        )
        rows = _make_parser()._parse_kml(kml, "lane_closure")
        assert len(rows) == 2
        assert rows[0]["external_incident_id"] != rows[1]["external_incident_id"]

    def test_different_closure_ids_at_the_same_point_stay_distinct(self):
        kml = (
            _lane_closure_placemark("C38BA", "1")
            + _lane_closure_placemark("C99ZZ", "1")
        )
        rows = _make_parser()._parse_kml(kml, "lane_closure")
        assert len(rows) == 2
        assert rows[0]["external_incident_id"] != rows[1]["external_incident_id"]
