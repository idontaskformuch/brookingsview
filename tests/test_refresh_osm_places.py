"""scripts/refresh_osm_places.py: the weekly OpenStreetMap snapshot behind /tonight's "Open late" block."""
from datetime import datetime, timedelta, timezone

import pytest
import requests

from scripts import refresh_osm_places as r

NOW = datetime(2026, 11, 2, 11, 0, tzinfo=timezone.utc)
TOWN = {"town_id": "glasgow", "lat": 55.8642, "lon": -4.2518, "radius_km": 5}


class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def post(self, url, data, headers, timeout):
        self.calls.append((url, data, headers))
        res = self.responses.pop(0)
        if isinstance(res, Exception):
            raise res
        return res


def test_query_asks_for_named_places_with_hours_in_the_radius():
    q = r.overpass_query(55.8642, -4.2518, 5)
    assert "around:5000,55.8642,-4.2518" in q
    assert '["opening_hours"]["name"]' in q


def test_query_asks_for_a_center_so_ways_get_a_position():
    assert r.overpass_query(55.8642, -4.2518, 5).endswith("out tags center;")


def test_slim_keeps_five_tags_and_drops_unnamed_or_hourless():
    out = r.slim_elements([
        {"type": "node", "id": 1, "tags": {"name": "A", "amenity": "pub", "opening_hours": "24/7", "phone": "x", "website": "w"}},
        {"type": "node", "id": 2, "tags": {"amenity": "pub", "opening_hours": "24/7"}},
        {"type": "node", "id": 3, "tags": {"name": "C", "amenity": "pub"}},
    ])
    assert out == [{"type": "node", "id": 1, "tags": {"name": "A", "amenity": "pub", "opening_hours": "24/7", "website": "w"}}]


def test_slim_keeps_a_nodes_position_and_a_ways_center_rounded():
    out = r.slim_elements([
        {"type": "node", "id": 1, "lat": 55.8642123456, "lon": -4.2518, "tags": {"name": "A", "opening_hours": "24/7"}},
        {"type": "way", "id": 2, "center": {"lat": 55.86, "lon": -4.25}, "tags": {"name": "B", "opening_hours": "24/7"}},
    ])
    assert (out[0]["lat"], out[0]["lon"]) == (55.864212, -4.2518)
    assert (out[1]["lat"], out[1]["lon"]) == (55.86, -4.25)


def test_slim_never_invents_a_position():
    out = r.slim_elements([{"type": "way", "id": 3, "tags": {"name": "C", "opening_hours": "24/7"}}])
    assert "lat" not in out[0] and "lon" not in out[0]


def test_snapshot_file_round_trips(tmp_path):
    els = [{"type": "node", "id": 1, "lat": 1.0, "lon": 2.0, "tags": {"name": "Ö", "opening_hours": "24/7"}}]
    f = tmp_path / "s.json"
    r.write_snapshot_file(f, "glasgow", els, NOW)
    assert r.read_snapshot_file(f) == els


def test_one_run_per_town_per_week():
    assert r.due(None, NOW)
    assert not r.due(NOW - timedelta(days=5), NOW)
    assert r.due(NOW - timedelta(days=7), NOW)
    assert r.due(NOW - timedelta(days=1), NOW, force=True)


def test_only_towns_with_open_late_in_config_are_fetched():
    ids = {t["town_id"] for t in r.towns_with_open_late()}
    assert ids == {"glasgow", "broomfield_co"}
    assert all(t["radius_km"] > 0 for t in r.towns_with_open_late())


def test_fetch_identifies_as_viewmediabot_and_returns_slim_elements(monkeypatch):
    monkeypatch.delenv("USER_AGENT", raising=False)
    s = FakeSession(FakeResponse(200, {"elements": [{"type": "node", "id": 1, "tags": {"name": "A", "opening_hours": "24/7", "amenity": "bar"}}]}))
    out = r.fetch(TOWN, session=s, sleep=lambda _: None)
    assert len(out) == 1
    assert s.calls[0][2]["User-Agent"].startswith("ViewMediaBot")


def test_fetch_backs_off_and_switches_mirror_on_errors():
    s = FakeSession(FakeResponse(429), requests.ConnectionError("down"), FakeResponse(200, {"elements": []}))
    sleeps = []
    assert r.fetch(TOWN, session=s, sleep=sleeps.append) == []
    assert [c[0] for c in s.calls] == [r.OVERPASS_ENDPOINTS[0], r.OVERPASS_ENDPOINTS[1], r.OVERPASS_ENDPOINTS[0]]
    assert sleeps == [30, 60]


def test_fetch_raises_after_three_failures_so_the_old_snapshot_stays():
    s = FakeSession(FakeResponse(502), FakeResponse(502), FakeResponse(502))
    with pytest.raises(RuntimeError):
        r.fetch(TOWN, session=s, sleep=lambda _: None)
    assert len(s.calls) == 3
