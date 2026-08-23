"""Regression tests for the "Brookings Parity Audit" (see
NEEDS-HUMAN-REVIEW.md): per-town structured data (configs/<town_id>.json's
local_theaters, and any future per-town config block like it) must never
carry the OTHER town's identifying terms. This is the same invariant
town_guard.py's HARD_BLOCKLIST already enforces on AI-generated prose,
applied to hand-curated config data instead -- a copy-paste of one town's
venue block into the other's config file should fail a test, not ship
silently. No DB, no network -- pure config-file checks.
"""
import json
from pathlib import Path

import pytest

from ai_pipeline.town_guard import HARD_BLOCKLIST

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_cfg(town_id: str) -> dict:
    return json.loads((REPO_ROOT / "configs" / f"{town_id}.json").read_text(encoding="utf-8"))


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
