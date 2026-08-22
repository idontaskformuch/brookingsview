"""Direct regression test for the actual root-cause bug (fixed 2026-08-07 in
a5ebec0 + e108341): every content/*.py module's SYSTEM_PROMPT_TEMPLATE used
to have "Brookings, South Dakota" hardcoded, so a Moreno Valley run still
told the model it was writing for Brookings. town_label(cfg) replaced the
hardcoding -- this test asserts the formatted prompt for each config never
contains the OTHER town's identifying terms, for every affected module,
including kvick_essa (contaminated per CONTAMINATION_REPORT.md's
kvick_essa-2026-07-25, even though the original audit brief's list of
affected content types didn't name it -- it was fixed by the same commit).

No AI call, no network, no DB -- just string formatting, so this is cheap
enough to run on every push.
"""
import json
from pathlib import Path

import pytest

from ai_pipeline.town_guard import HARD_BLOCKLIST
from content._base import town_label
from content.kronikor import culture_essay, editorial, kvick_essa, vetenskap
from content.recensioner import media_recension
from content.recept import vardagsmiddag

REPO_ROOT = Path(__file__).resolve().parent.parent

MODULES = [culture_essay, editorial, vetenskap, kvick_essa, media_recension, vardagsmiddag]


def _load_cfg(town_id: str) -> dict:
    return json.loads((REPO_ROOT / "configs" / f"{town_id}.json").read_text(encoding="utf-8"))


class _KeepUnknownPlaceholders(dict):
    """vardagsmiddag.SYSTEM_PROMPT_TEMPLATE has extra {ingredients_start}-style
    placeholders beyond {town} (filled from that module's own private marker
    constants at call time). We only care about the {town} substitution here,
    so leave any other placeholder as literal text rather than reach into
    another module's private constants just to satisfy .format()."""
    def __missing__(self, key):
        return "{" + key + "}"


def _render_prompt(template: str, town: str) -> str:
    return template.format_map(_KeepUnknownPlaceholders(town=town))


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_system_prompt_has_no_cross_town_terms(module, town_id):
    cfg = _load_cfg(town_id)
    prompt = _render_prompt(module.SYSTEM_PROMPT_TEMPLATE, town_label(cfg))

    # HARD_BLOCKLIST is keyed by "town this list applies to" -- e.g.
    # HARD_BLOCKLIST['brookings_sd'] is the set of Moreno-Valley-identifying
    # terms banned FROM Brookings content. So a Brookings prompt is checked
    # against HARD_BLOCKLIST[town_id] directly, NOT the other town's list
    # (that list is the OTHER town's own name, which obviously belongs in
    # its own prompt -- checking it here would be backwards).
    for term in HARD_BLOCKLIST[town_id]:
        assert term.casefold() not in prompt.casefold(), (
            f"{module.__name__}'s system prompt for {town_id} contains "
            f"a blocklist term {term!r} that belongs to the other town -- "
            f"regression of the 2026-08-07 hardcoded-town-name bug (a5ebec0/e108341)"
        )


@pytest.mark.parametrize("town_id", list(HARD_BLOCKLIST.keys()))
def test_town_label_contains_own_display_name(town_id):
    cfg = _load_cfg(town_id)
    label = town_label(cfg)
    assert cfg["display_name"] in label
