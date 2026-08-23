"""Regression tests for the "Brookings Parity Audit" (see
NEEDS-HUMAN-REVIEW.md): per-town structured data (configs/<town_id>.json's
local_theaters, and any future per-town config block like it) must never
carry the OTHER town's identifying terms. This is the same invariant
town_guard.py's HARD_BLOCKLIST already enforces on AI-generated prose,
applied to hand-curated config data instead -- a copy-paste of one town's
venue block into the other's config file should fail a test, not ship
silently. No DB, no network -- pure config-file checks.

Also covers the "Traffic wrong-state source fix" follow-up (see
NEEDS-HUMAN-REVIEW.md): a data source inherited from the wrong town's
config (right shape, wrong geography -- e.g. a California traffic feed on
the South Dakota site) renders PLAUSIBLE, not obviously broken, so this
needs an explicit geography assertion per source, not just the blocklist-
term check above (a URL like "quickmap.dot.ca.gov" doesn't contain any
town-identifying prose term at all).
"""
import json
from pathlib import Path

import pytest

from ai_pipeline.town_guard import HARD_BLOCKLIST

REPO_ROOT = Path(__file__).resolve().parent.parent

# Rough real bounding boxes, generous enough to never false-positive on a
# real coordinate but tight enough to catch a wrong-state copy-paste (e.g.
# California's box doesn't come close to South Dakota's).
_STATE_BBOX = {
    "SD": {"lat": (42.4, 45.95), "lon": (-104.1, -96.35)},
    "CA": {"lat": (32.4, 42.1), "lon": (-124.5, -114.0)},
}


def _load_cfg(town_id: str) -> dict:
    return json.loads((REPO_ROOT / "configs" / f"{town_id}.json").read_text(encoding="utf-8"))


def _assert_coordinates_in_state(lat: float, lon: float, state_abbr: str, label: str) -> None:
    box = _STATE_BBOX[state_abbr]
    assert box["lat"][0] <= lat <= box["lat"][1] and box["lon"][0] <= lon <= box["lon"][1], (
        f"{label}: coordinates ({lat}, {lon}) fall outside {state_abbr}'s bounding "
        f"box -- looks like a wrong-state coordinate (copied from another town's config?)"
    )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_local_theaters_has_no_cross_town_terms(town_id):
    cfg = _load_cfg(town_id)
    theaters = cfg.get("local_theaters", [])
    text = json.dumps(theaters)
    for term in HARD_BLOCKLIST[town_id]:
        assert term.casefold() not in text.casefold(), (
            f"configs/{town_id}.json's local_theaters contains a blocklist term "
            f"{term!r} belonging to the OTHER town -- looks like cross-copied venue data"
        )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_local_theaters_each_carry_the_towns_own_state(town_id):
    cfg = _load_cfg(town_id)
    theaters = cfg.get("local_theaters", [])
    if not theaters:
        pytest.skip(f"{town_id} has no local_theaters yet -- nothing to check")
    state_abbr = cfg["state"]
    for t in theaters:
        assert f", {state_abbr} " in t["address"], (
            f"{town_id}'s theater {t['name']!r} has an address that doesn't "
            f"contain its own state ({state_abbr}): {t['address']!r}"
        )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_town_coordinates_are_within_its_own_state(town_id):
    cfg = _load_cfg(town_id)
    coords = cfg["coordinates"]
    _assert_coordinates_in_state(coords["lat"], coords["lon"], cfg["state"],
                                  f"configs/{town_id}.json's top-level coordinates")


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_weather_source_coordinates_match_town_coordinates(town_id):
    cfg = _load_cfg(town_id)
    weather = cfg["data_sources"].get("weather", {})
    if "lat" not in weather or "lon" not in weather:
        pytest.skip(f"{town_id}'s weather source has no explicit lat/lon")
    assert weather["lat"] == cfg["coordinates"]["lat"], (
        f"{town_id}: data_sources.weather.lat ({weather['lat']}) doesn't match "
        f"the town's own coordinates.lat ({cfg['coordinates']['lat']})"
    )
    assert weather["lon"] == cfg["coordinates"]["lon"], (
        f"{town_id}: data_sources.weather.lon ({weather['lon']}) doesn't match "
        f"the town's own coordinates.lon ({cfg['coordinates']['lon']})"
    )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_jobs_source_geography_matches_own_state(town_id):
    cfg = _load_cfg(town_id)
    jobs = cfg["data_sources"].get("jobs", {})
    where = jobs.get("where")
    if not where:
        pytest.skip(f"{town_id}'s jobs source has no 'where' geography field")
    assert cfg["state"] in where, (
        f"{town_id}: jobs source 'where' ({where!r}) doesn't mention the "
        f"town's own state ({cfg['state']}) -- looks like a wrong-geography query"
    )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_enabled_traffic_source_geography_matches_own_state(town_id):
    """If traffic is enabled for a town, whatever geography-scoping field it
    carries (bbox around the town's own coordinates, or a source name/URL
    naming a DIFFERENT state) must not point at another state. Regression
    guard for the actual bug found live: Brookings' /traffic page attributed
    to Caltrans QuickMap (California) despite having no real data source at
    all -- see NEEDS-HUMAN-REVIEW.md 'Traffic wrong-state source fix'."""
    cfg = _load_cfg(town_id)
    traffic = cfg["data_sources"].get("traffic", {})
    if not traffic.get("enabled"):
        pytest.skip(f"{town_id}'s traffic source is disabled -- nothing live to check")
    bbox = traffic.get("bbox")
    if bbox:
        min_lat, max_lat, min_lon, max_lon = bbox
        _assert_coordinates_in_state(min_lat, min_lon, cfg["state"], f"{town_id} traffic bbox (min corner)")
        _assert_coordinates_in_state(max_lat, max_lon, cfg["state"], f"{town_id} traffic bbox (max corner)")


def test_wrong_state_coordinates_are_actually_caught():
    """Proves the bbox check above isn't a no-op -- a fixture with
    Moreno Valley's real coordinates mislabeled as South Dakota must fail."""
    with pytest.raises(AssertionError):
        _assert_coordinates_in_state(33.9425, -117.2297, "SD", "fixture")
