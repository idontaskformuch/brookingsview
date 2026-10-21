"""configs/<town>.json features.top_events and site-config.ts's topEvents are two
hand-synced copies (same arrangement as every other feature flag). They must agree,
and the config must hold patterns -- never dates."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SITE_CONFIG = (ROOT / "site" / "src" / "lib" / "site-config.ts").read_text(encoding="utf-8")
TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co"]


def _json(town):
    return json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))["features"].get("top_events")


def _ts_blocks():
    """town_id -> text of its block in CITIES (split on the `townId:` markers)."""
    parts = re.split(r"townId: '(\w+)'", SITE_CONFIG)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


@pytest.mark.parametrize("town", TOWNS)
def test_top_events_match_between_json_and_site_config(town):
    cfg = _json(town)
    block = _ts_blocks()[town]
    m = re.search(r"topEvents:\s*\{\s*patterns:\s*\[([^\]]*)\],\s*leadDays:\s*(\d+)\s*\}", block)
    if cfg is None:
        assert m is None, f"{town}: site-config has topEvents but the JSON has no top_events"
        return
    assert m, f"{town}: JSON has top_events but site-config.ts has no topEvents"
    ts_patterns = re.findall(r"'([^']+)'", m.group(1))
    assert ts_patterns == cfg["patterns"]
    assert int(m.group(2)) == cfg["lead_days"]


@pytest.mark.parametrize("town", TOWNS)
def test_patterns_are_words_not_dates(town):
    cfg = _json(town)
    for pattern in (cfg or {}).get("patterns", []):
        assert not re.search(r"\d{4}|\d{1,2}[/-]\d{1,2}", pattern), f"{town}: {pattern!r} looks like a date"
