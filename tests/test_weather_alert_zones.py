"""Pins the NWS zone codes used to fetch weather alerts (AdSense
remediation Phase B3) -- a county-level zone (e.g. CAC065 for all of
Riverside County) is too coarse and pulls in alerts for unrelated areas
(confirmed live 2026-08-29: querying CAC065 returned a Coachella Valley
alert and one for the Arizona border, alongside the one genuinely
covering Moreno Valley; querying the precise forecast/fire zone pair
CAZ048,CAZ248 returned only the real one). This test exists so a future
edit can't silently revert `weather_alerts.area` back to a county code
without a human noticing and re-verifying against api.weather.gov/points.
"""
import json
from pathlib import Path

CONFIGS_DIR = Path(__file__).resolve().parent.parent / "configs"

# Verified live via api.weather.gov/points at each town's center AND edges
# (to catch a town straddling a zone boundary, as Broomfield does -- see
# configs/broomfield_co.json's own _area_notes). Never a county-level
# (...C0NN) code -- those are exactly the over-broad zones this fixes.
EXPECTED_AREAS = {
    "moreno_valley_ca": "CAZ048,CAZ248",
    "brookings_sd": "SDZ040",
    "broomfield_co": "COZ039,COZ040,COZ239,COZ240",
}


def _load(town_id: str) -> dict:
    return json.loads((CONFIGS_DIR / f"{town_id}.json").read_text(encoding="utf-8"))


def test_weather_alerts_area_matches_verified_precise_zones():
    for town_id, expected_area in EXPECTED_AREAS.items():
        cfg = _load(town_id)
        assert cfg["data_sources"]["weather_alerts"]["area"] == expected_area, town_id


def test_no_config_uses_a_county_level_zone_code():
    # County codes have the shape <state><C><digits> (e.g. CAC065, SDC011,
    # COC014) -- the exact over-broad shape this fix replaces. A forecast
    # or fire-weather zone always has "Z" in that same position instead.
    for town_id in EXPECTED_AREAS:
        cfg = _load(town_id)
        area = cfg["data_sources"]["weather_alerts"]["area"]
        for zone in area.split(","):
            assert len(zone) >= 3 and zone[2] != "C", f"{town_id}: {zone!r} looks like a county-level zone code"


def test_closure_watch_weather_zones_stays_in_sync_with_weather_alerts_area():
    # closure_watch.weather_zones is documentation, not read by any code
    # path (confirmed live) -- but it exists specifically to describe
    # weather_alerts.area for a human reading the config, so a drift
    # between the two is a real, if low-stakes, correctness bug.
    for town_id, expected_area in EXPECTED_AREAS.items():
        cfg = _load(town_id)
        closure_watch = cfg["features"].get("closure_watch")
        if closure_watch is None:
            continue
        assert closure_watch["weather_zones"] == expected_area.split(","), town_id
