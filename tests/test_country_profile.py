"""Country / nation profile layer (Glasgow Phase 1), Python side."""
import json
from pathlib import Path

import pytest

from ai_pipeline.town_guard import _build_hard_blocklist
from config.country_profile import (
    country_of, is_us, load_country, profile_for, validate_place_config,
)
from content._base import town_label
from validation.place_state import check_place_state

ROOT = Path(__file__).resolve().parent.parent
TOWN_CONFIGS = sorted((ROOT / "configs").glob("*.json"))

GLASGOW = {
    "town_id": "glasgow", "country": "gb", "nation": "scotland", "region": "Scotland",
    "display_name": "Glasgow", "county": "Glasgow City",
    "identity": {"terms": ["Celtic Park", "Ibrox", "Kelvingrove"]},
}


def test_profiles_load_and_match_the_spec():
    gb = load_country("gb")
    assert gb["locale"] == "en-GB" and gb["currency"] == "GBP" and gb["temperatureUnit"] == "C"
    assert gb["defaultTimezone"] == "Europe/London" and gb["spelling"] == "british"
    assert gb["legal"]["variant"] == "gb" and gb["legal"]["consent"].startswith("opt-in")
    assert "burns_night" in gb["nations"]["scotland"]["holidays"]
    us = load_country("us")
    assert us["locale"] == "en-US" and us["addressCountry"] == "US" and us["defaultTimezone"] is None


def test_unknown_country_raises():
    with pytest.raises(ValueError):
        load_country("xx")


US_TOWNS = {"brookings_sd", "moreno_valley_ca", "broomfield_co"}


def test_town_configs_declare_their_country_and_pass_the_gate():
    assert TOWN_CONFIGS
    for path in TOWN_CONFIGS:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        assert validate_place_config(cfg) == [], path.name
        if cfg["town_id"] in US_TOWNS:
            assert country_of(cfg) == "us" and is_us(cfg)
        else:
            assert country_of(cfg) == "gb" and not is_us(cfg), path.name


def test_missing_country_key_means_us():
    assert country_of({"town_id": "x", "state": "SD"}) == "us"
    assert profile_for(None)["id"] == "us"


def test_gate_us_needs_state_gb_needs_region_and_nation():
    assert validate_place_config({"town_id": "x", "country": "us"}) == ["x: state is required for country us"]
    assert len(validate_place_config({"town_id": "x", "country": "gb"})) == 2
    assert len(validate_place_config({"town_id": "x", "country": "gb", "region": "Wales", "nation": "wales"})) == 1
    assert validate_place_config(GLASGOW) == []


def test_town_label_us_unchanged_and_gb_uses_region():
    assert town_label({"display_name": "Brookings", "state": "SD"}) == "Brookings, South Dakota"
    assert town_label({"display_name": "Glasgow", "country": "gb", "region": "Scotland"}) == "Glasgow, Scotland"
    assert town_label({"display_name": "Glasgow", "country": "gb"}) == "Glasgow"


def test_place_state_check_skips_gb_but_still_fires_for_us():
    text = "The festival in Georgia drew a crowd."
    assert check_place_state(text, [], {"country": "gb", "region": "Scotland"}).passed
    assert not check_place_state(text, [], {"state": "SD"}).passed


def test_town_guard_blocklist_is_two_way_with_a_gb_town():
    us = {
        "town_id": "brookings_sd", "display_name": "Brookings", "county": "Brookings County",
        "identity": {"terms": ["SDSU"]},
    }
    blocklist = _build_hard_blocklist({"brookings_sd": us, "glasgow": GLASGOW})
    assert "Celtic Park" in blocklist["brookings_sd"] and "Glasgow" in blocklist["brookings_sd"]
    assert "SDSU" in blocklist["glasgow"] and "Brookings" in blocklist["glasgow"]
    assert "Glasgow" not in blocklist["glasgow"]
