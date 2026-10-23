"""Met Office NSWWS adapter -- real 2026-10-23 snapshot (Storm Boelo weekend) as fixture.

Owner's acceptance case: for Glasgow (55.8642, -4.2518) the AMBER and the YELLOW
wind warnings are stored, the YELLOW rain warning (which lists Strathclyde in
affectedAreas but whose polygon does not contain the point) is NOT.
"""
import json
from pathlib import Path

from scrapers.base_parser import FetchResult
from scrapers.parsers.met_office_warnings_v1 import (
    MetOfficeWarningsParser,
    newest_per_warning,
    parse_feed,
    point_in_geometry,
    to_record,
)

FIX = Path(__file__).parent / "fixtures"
LON, LAT = -4.2518, 55.8642
CFG = {"town_id": "glasgow", "coordinates": {"lat": LAT, "lon": LON}}


def _snapshot():
    return json.loads((FIX / "met_office_nswws_issued_2026-10-23.json").read_text(encoding="utf-8"))


def _glasgow_features():
    return [f for f in _snapshot()["features"] if point_in_geometry(LON, LAT, f["geometry"])]


def test_storm_boelo_amber_and_yellow_wind_cover_glasgow_rain_does_not():
    got = sorted((f["properties"]["warningLevel"], tuple(eval(str(f["properties"]["weatherType"])))) for f in _glasgow_features())
    assert got == [("AMBER", ("WIND",)), ("YELLOW", ("WIND",))]


def test_rain_warning_lists_strathclyde_but_is_outside_by_polygon():
    rain = [f for f in _snapshot()["features"] if "RAIN" in str(f["properties"]["weatherType"])]
    assert len(rain) == 1
    assert "ST" in str(rain[0]["properties"]["affectedAreas"])
    assert not point_in_geometry(LON, LAT, rain[0]["geometry"])


def test_parse_makes_one_record_per_warning_with_expected_fields():
    parser = MetOfficeWarningsParser(CFG, {})
    raw = json.dumps({"features": [{"properties": f["properties"]} for f in _glasgow_features()]}).encode()
    recs = parser.parse(FetchResult(raw=raw))
    assert len(recs) == 2
    amber = next(r for r in recs if r["raw_data"]["level"] == "amber")
    assert amber["source"] == "met_office_warning"
    assert amber["starts_at"] == "2026-10-24T20:00:00Z" and amber["ends_at"] == "2026-10-25T21:00:00Z"
    rd = amber["raw_data"]
    assert rd["status"] == "ISSUED" and rd["weather_types"] == ["WIND"]
    assert isinstance(rd["what_to_expect"], list) and rd["what_to_expect"]
    assert rd["what_should_i_do"] and rd["headline"] and rd["warning_id"]
    assert "Strathclyde" in " ".join(rd["regions"])
    assert parser.identity_key == "warning_id"


def test_feed_links_are_followed_not_built():
    related, entries = parse_feed((FIX / "met_office_nswws_feed_2026-10-23.xml").read_bytes())
    assert related.startswith("https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/issued/")
    assert len(entries) == 6
    assert all(e["href"].startswith("https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/updated/") for e in entries)
    assert [e["updated"] for e in entries] == sorted(e["updated"] for e in entries)  # oldest first


def _feat(wid, version, status, modified):
    return {"properties": {"warningId": wid, "warningVersion": version, "warningStatus": status,
                           "modifiedDate": modified, "warningLevel": "YELLOW", "weatherType": ["WIND"],
                           "warningHeadline": "h", "validFromDate": "2026-10-24T00:00:00Z", "validToDate": "2026-10-25T00:00:00Z"}}


def test_expired_and_cancelled_replace_an_issued_state_for_the_same_warning():
    for terminal in ("EXPIRED", "CANCELLED"):
        best = newest_per_warning([_feat("w", "2.0", "ISSUED", "2026-10-23T08:00:00Z"),
                                   _feat("w", "3.0", terminal, "2026-10-23T09:00:00Z")])
        assert best["w"]["properties"]["warningStatus"] == terminal
        assert to_record(best["w"])["raw_data"]["status"] == terminal


def test_an_older_update_never_overwrites_a_newer_state():
    best = newest_per_warning([_feat("w", "3.0", "EXPIRED", "2026-10-23T09:00:00Z"),
                               _feat("w", "2.0", "ISSUED", "2026-10-23T08:00:00Z")])
    assert best["w"]["properties"]["warningStatus"] == "EXPIRED"


def test_stringified_list_fields_are_parsed():
    f = _feat("w", "1.0", "ISSUED", "2026-10-23T08:00:00Z")
    f["properties"]["whatToExpect"] = "['Flying debris is likely', 'Power cuts are likely']"
    assert to_record(f)["raw_data"]["what_to_expect"] == ["Flying debris is likely", "Power cuts are likely"]


def test_polygon_holes_and_multipolygons():
    square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    poly = {"type": "Polygon", "coordinates": [square, hole]}
    assert point_in_geometry(1, 1, poly)
    assert not point_in_geometry(5, 5, poly)
    assert not point_in_geometry(11, 5, poly)
    multi = {"type": "MultiPolygon", "coordinates": [[square], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]]}
    assert point_in_geometry(25, 25, multi)
    assert not point_in_geometry(15, 15, multi)
    assert not point_in_geometry(1, 1, None)
