"""Regression/unit tests for scrapers/parsers/cdot_v1.py -- mirrors
tests/test_traffic_parser.py's pattern for the Caltrans parser.
"""
from scrapers.parsers.cdot_v1 import (
    CdotParser,
    _classify_severity,
    _is_closure_type,
    _parse_iso,
)


def _parser():
    cfg = {"town_id": "broomfield_co", "coordinates": {"lat": 39.9205, "lon": -105.0866}}
    source_cfg = {"url": "https://data.cotrip.org/api/v1/incidents"}
    return CdotParser(cfg, source_cfg)


def test_is_closure_type_maintenance():
    assert _is_closure_type("Maintenance Operations") is True


def test_is_closure_type_debris_is_not_closure():
    assert _is_closure_type("Debris") is False


def test_severity_uses_structured_injury_count():
    assert _classify_severity({"injuries": 1, "type": "Crash"}) == "injury"


def test_severity_uses_structured_fatality_count():
    assert _classify_severity({"fatalities": 1, "type": "Crash"}) == "injury"


def test_severity_closure_keyword_in_message():
    props = {"type": "Road Work", "travelerInformationMessage": "Full closure of eastbound lanes"}
    assert _classify_severity(props) == "closure"


def test_severity_planned_keyword():
    props = {"type": "Maintenance Operations", "travelerInformationMessage": "Scheduled lane work"}
    assert _classify_severity(props) == "planned"


def test_severity_defaults_to_incident():
    props = {"type": "Other Activity", "travelerInformationMessage": "Vehicle on shoulder"}
    assert _classify_severity(props) == "incident"


def test_parse_iso_handles_zulu_suffix():
    dt = _parse_iso("2026-08-27T15:37:24.209Z")
    assert dt is not None
    assert dt.tzinfo is not None


def test_parse_iso_none_when_missing():
    assert _parse_iso(None) is None


def test_anchor_in_bbox_point_within():
    p = _parser()
    geometry = {"type": "Point", "coordinates": [-105.0866, 39.9205]}
    assert p._anchor_in_bbox(geometry) == (39.9205, -105.0866)


def test_anchor_in_bbox_multipoint_partially_outside():
    p = _parser()
    # första punkten långt utanför Broomfield, andra punkten precis vid centrum --
    # ska ändå matcha eftersom NÅGON punkt räcker (se moduldocstring).
    geometry = {
        "type": "MultiPoint",
        "coordinates": [[-104.0, 39.0], [-105.0866, 39.9205]],
    }
    assert p._anchor_in_bbox(geometry) == (39.9205, -105.0866)


def test_anchor_in_bbox_none_when_all_points_outside():
    p = _parser()
    geometry = {"type": "MultiPoint", "coordinates": [[-102.0, 38.0], [-102.1, 38.1]]}
    assert p._anchor_in_bbox(geometry) is None


def test_parse_builds_rows_from_feature_collection():
    p = _parser()

    class _Fetched:
        raw = (
            b'{"type": "FeatureCollection", "features": ['
            b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-105.0866, 39.9205]}, '
            b'"properties": {"id": "OpenTMS-Incident1", "type": "Maintenance Operations", '
            b'"routeName": "US-36", "travelerInformationMessage": "Right lane closed for repaving", '
            b'"startTime": "2026-08-27T15:37:24.209Z", "injuries": 0, "fatalities": 0, '
            b'"lastUpdated": "2026-08-27T15:40:16.850Z"}}'
            b']}'
        )

    rows = p.parse(_Fetched())
    assert len(rows) == 1
    row = rows[0]
    assert row["external_incident_id"] == "OpenTMS-Incident1"
    assert row["incident_type"] == "lane_closure"
    assert row["road"] == "US-36"
    assert row["title"] == "Maintenance Operations on US-36"
    assert row["ends_at"] is None
    assert row["lat"] == 39.9205 and row["lon"] == -105.0866
    assert row["content_hash"]


def test_parse_skips_features_outside_bbox():
    p = _parser()

    class _Fetched:
        raw = (
            b'{"type": "FeatureCollection", "features": ['
            b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-102.0, 38.0]}, '
            b'"properties": {"id": "OpenTMS-Incident2", "type": "Debris", "routeName": "I-70"}}'
            b']}'
        )

    assert p.parse(_Fetched()) == []


def test_parse_uses_clear_time_as_ends_at_when_present():
    p = _parser()

    class _Fetched:
        raw = (
            b'{"type": "FeatureCollection", "features": ['
            b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-105.0866, 39.9205]}, '
            b'"properties": {"id": "OpenTMS-Incident3", "type": "Law Enforcement Activity", '
            b'"routeName": "I-25S", "status": "event cleared", '
            b'"startTime": "2026-08-27T16:23:52.071Z", "clearTime": "2026-08-27T16:34:39.491Z"}}'
            b']}'
        )

    rows = p.parse(_Fetched())
    assert len(rows) == 1
    assert rows[0]["ends_at"] is not None


def test_parse_skips_features_without_id():
    p = _parser()

    class _Fetched:
        raw = (
            b'{"type": "FeatureCollection", "features": ['
            b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-105.0866, 39.9205]}, '
            b'"properties": {"type": "Debris", "routeName": "I-70"}}'
            b']}'
        )

    assert p.parse(_Fetched()) == []
