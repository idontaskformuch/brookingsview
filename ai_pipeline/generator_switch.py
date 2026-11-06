"""Per-generator on/off switch, read from the town config: ai.generators.<name>.enabled (default true, so a generator that is
not listed behaves exactly as before). Separate from features.*.enabled on purpose: those also decide whether the SITE shows a
page (hasWhatsOn, hasClosureWatch), so turning a feature off to stop an AI call would remove the page too.

Used to stop model calls whose output the site no longer reads (owner 2026-11-06). Nothing is deleted: the code, the stored rows and the
tables stay, and flipping a switch back to true restores the old behaviour."""


def generator_enabled(cfg: dict, name: str) -> bool:
    entry = (cfg.get("ai") or {}).get("generators", {}).get(name)
    if entry is None:
        return True
    return bool(entry.get("enabled", True)) if isinstance(entry, dict) else bool(entry)
