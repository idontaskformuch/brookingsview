"""Validation for configs/<town_id>.json's "features" block (Handoff:
Information Hub Tier 1 -- Closure Watch / New in Town / Housing Market).

Two invariants, both regression guards for the same failure class that let
"Brookings, South Dakota" stay hardcoded for months (see
ai_pipeline/town_guard.py, tests/test_town_parity.py): silent partial
configuration.

1. A feature flagged enabled:true must carry every field its page-rendering
   and pipeline code depends on, non-empty. A disabled feature renders
   nothing, so an incomplete config for it is harmless.
2. The Python config (configs/<town_id>.json) and the Astro config
   (site/src/lib/site-config.ts) are two hand-synced systems -- see
   site-config.ts's own module docstring ("OBS: hall vardena i synk med
   configs/<town_id>.json"). A feature flag that drifts between the two
   (e.g. the Python side says enabled but nobody added the matching
   has<Feature> boolean to site-config.ts, or vice versa) must fail here,
   not ship as a page with no nav link or a nav link with no page.

No DB, no network -- pure config-file checks, same style as
tests/test_town_parity.py.
"""
import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_CONFIG_TS = REPO_ROOT / "site" / "src" / "lib" / "site-config.ts"

TOWN_IDS = ["brookings_sd", "moreno_valley_ca", "broomfield_co"]

REQUIRED_FIELDS_WHEN_ENABLED = {
    "closure_watch": ["districts", "weather_zones", "relevant_alert_events"],
    "new_in_town": ["search_terms", "location_qualifiers"],
    "housing_market": ["sales_source"],
}

# Maps the Python config key to the matching site-config.ts SiteConfig field.
FEATURE_TS_FLAG = {
    "closure_watch": "hasClosureWatch",
    "new_in_town": "hasNewInTown",
    "housing_market": "hasHousingMarket",
}


def _load_cfg(town_id: str) -> dict:
    return json.loads((REPO_ROOT / "configs" / f"{town_id}.json").read_text(encoding="utf-8"))


def _extract_ts_town_blocks() -> dict[str, str]:
    """Split site-config.ts's CITIES object into one text chunk per town,
    from its `townId: '...'` line up to the next town's (or EOF). Good
    enough for a flat, hand-written config object -- not a real TS parser."""
    text = SITE_CONFIG_TS.read_text(encoding="utf-8")
    matches = list(re.finditer(r"townId:\s*'([a-z_]+)'", text))
    blocks = {}
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        blocks[m.group(1)] = text[start:end]
    return blocks


def _ts_flag_enabled(block: str, ts_flag: str) -> bool:
    m = re.search(rf"{ts_flag}:\s*(true|false)", block)
    return m is not None and m.group(1) == "true"


@pytest.mark.parametrize("town_id", TOWN_IDS)
def test_features_block_exists_with_all_keys(town_id):
    cfg = _load_cfg(town_id)
    assert "features" in cfg, f"{town_id}.json is missing a top-level 'features' block"
    for key in REQUIRED_FIELDS_WHEN_ENABLED:
        assert key in cfg["features"], f"{town_id}.json's features block is missing '{key}'"


@pytest.mark.parametrize("town_id", TOWN_IDS)
@pytest.mark.parametrize("feature_key", list(REQUIRED_FIELDS_WHEN_ENABLED))
def test_enabled_feature_has_required_fields(town_id, feature_key):
    cfg = _load_cfg(town_id)
    feature = cfg["features"][feature_key]
    if not feature.get("enabled"):
        pytest.skip(f"{town_id}'s {feature_key} is disabled -- nothing to validate")
    for field in REQUIRED_FIELDS_WHEN_ENABLED[feature_key]:
        value = feature.get(field)
        assert value, (
            f"{town_id}.json: features.{feature_key}.enabled is true but "
            f"'{field}' is empty/missing -- an enabled feature must not ship "
            f"with a blank required field"
        )


@pytest.mark.parametrize("town_id", TOWN_IDS)
@pytest.mark.parametrize("feature_key,ts_flag", list(FEATURE_TS_FLAG.items()))
def test_ts_flag_matches_python_config(town_id, feature_key, ts_flag):
    cfg = _load_cfg(town_id)
    python_enabled = bool(cfg["features"][feature_key].get("enabled"))
    blocks = _extract_ts_town_blocks()
    assert town_id in blocks, f"site-config.ts has no townId block for {town_id!r}"
    ts_enabled = _ts_flag_enabled(blocks[town_id], ts_flag)
    assert ts_enabled == python_enabled, (
        f"{town_id}: configs/{town_id}.json features.{feature_key}.enabled="
        f"{python_enabled} but site-config.ts's {ts_flag} is "
        f"{'true' if ts_enabled else 'false/absent'} for that town -- these two "
        f"config systems must be kept in sync by hand (see site-config.ts's own "
        f"module docstring)"
    )


def test_missing_required_field_is_actually_caught():
    """Proves the required-fields check above isn't a no-op."""
    broken_feature = {"enabled": True, "districts": [], "weather_zones": ["X"], "relevant_alert_events": ["Y"]}
    with pytest.raises(AssertionError):
        for field in REQUIRED_FIELDS_WHEN_ENABLED["closure_watch"]:
            assert broken_feature.get(field), f"should fail on empty {field}"


def test_ts_python_mismatch_is_actually_caught():
    """Proves the cross-system sync check above isn't a no-op."""
    fake_block = "townId: 'fake_town', hasClosureWatch: false,"
    ts_enabled = _ts_flag_enabled(fake_block, "hasClosureWatch")
    with pytest.raises(AssertionError):
        assert ts_enabled == True, "python says enabled, ts says disabled -- should fail"  # noqa: E712
