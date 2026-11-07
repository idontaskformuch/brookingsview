"""Per-generator on/off switch, read from the town config: ai.generators.<name>.enabled. FAILS CLOSED (owner 2026-11-07): a generator
that is not listed is OFF and makes no model call, so a new or forgotten generator can never spend money by default. Every generator that
should run needs an explicit `"enabled": true` in each town config (tests/test_generator_switch.py checks that every switch name used in
code is listed in every config). Separate from features.*.enabled on purpose: those also decide whether the SITE shows a
page (hasWhatsOn, hasClosureWatch), so turning a feature off to stop an AI call would remove the page too.

Used to stop model calls whose output the site no longer reads (owner 2026-11-06). Nothing is deleted: the code, the stored rows and the
tables stay, and flipping a switch back to true restores the old behaviour."""

# An entry that is missing, or does not say enabled, is off.


def generator_enabled(cfg: dict, name: str) -> bool:
    entry = (cfg.get("ai") or {}).get("generators", {}).get(name)
    if entry is None:
        return False
    return entry.get("enabled") is True if isinstance(entry, dict) else entry is True
