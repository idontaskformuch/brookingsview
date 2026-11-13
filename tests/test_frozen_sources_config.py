"""configs/<town>.json data_sources.events.sources[].frozen and site/src/lib/frozen-sources.mjs FROZEN_EVENT_SOURCES are two
hand-synced copies (owner 2026-11-13, the frozen-source filter). They must agree, town by town and source by source."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MJS = (ROOT / "site" / "src" / "lib" / "frozen-sources.mjs").read_text(encoding="utf-8")
TOWNS = sorted(p.stem for p in (ROOT / "configs").glob("*.json") if not p.stem.startswith("_"))


def _json_frozen(town):
    cfg = json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))
    sources = ((cfg.get("data_sources") or {}).get("events") or {}).get("sources") or []
    return {s["name"]: s["frozen"] for s in sources if isinstance(s, dict) and "frozen" in s}


def _mjs_frozen(town):
    block = re.search(rf"\b{town}: \{{(.*?)\n  \}},", MJS, re.S)
    if not block:
        return {}
    return {name: {"since": since, "show_days": int(days)}
            for name, since, days in re.findall(r"(\w+): \{ since: '([\d-]+)', showDays: (\d+) \}", block.group(1))}


@pytest.mark.parametrize("town", TOWNS)
def test_frozen_sources_match_between_json_and_mjs(town):
    assert _json_frozen(town) == _mjs_frozen(town)


def test_moreno_tockify_feeds_are_frozen_from_2026_11_13_for_14_days():
    expected = {"since": "2026-11-13", "show_days": 14}
    assert _json_frozen("moreno_valley_ca") == {"city_events": expected, "library": expected}
