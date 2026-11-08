"""Validate a town's `sports` block. Any problem fails the build (tests/test_sports_config.py and `python -m sports.check --validate-all`)."""
from __future__ import annotations

import re

from scrapers import robots
from sports import adapters, registry

NON_ADAPTER_SOURCES = ("manual_verified", "submissions")
_TOP = {"enabled", "nearby_radius_miles", "programs", "rivalries", "sources", "source_priority", "submissions"}
_PROGRAM = {"id", "name", "short", "nickname", "colors", "home_venue", "level_default"}
_SOURCE = {"adapter", "program", "sport", "level", "gender", "url", "params", "robots_mode"}
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_sports_config(cfg: dict) -> list[str]:
    town = cfg.get("town_id", "?")
    block = cfg.get("sports")
    if block is None:
        return []
    if not isinstance(block, dict):
        return [f"{town}: sports must be an object"]
    p: list[str] = []

    def bad(msg: str) -> None:
        p.append(f"{town}: sports.{msg}")

    for key in sorted(set(block) - _TOP):
        bad(f"{key}: unknown key")
    if not isinstance(block.get("enabled"), bool):
        bad("enabled: required, true or false")
    radius = block.get("nearby_radius_miles", 30)
    if isinstance(radius, bool) or not isinstance(radius, (int, float)) or radius <= 0:
        bad("nearby_radius_miles: must be a positive number")

    ids: set[str] = set()
    for i, prog in enumerate(block.get("programs") or []):
        where = f"programs[{i}]"
        if not isinstance(prog, dict):
            bad(f"{where}: must be an object")
            continue
        for key in sorted(set(prog) - _PROGRAM):
            bad(f"{where}.{key}: unknown key")
        pid = prog.get("id")
        if not isinstance(pid, str) or not _SLUG.match(pid):
            bad(f"{where}.id: required lowercase slug")
        elif pid in ids:
            bad(f"{where}.id: duplicate {pid!r}")
        else:
            ids.add(pid)
        if not prog.get("name"):
            bad(f"{where}.name: required")
        colors = prog.get("colors")
        if colors is not None and not (isinstance(colors, list) and len(colors) == 2 and all(isinstance(c, str) and _HEX.match(c) for c in colors)):
            bad(f"{where}.colors: need two #rrggbb values")
        level = prog.get("level_default")
        if level is not None and level not in registry.levels():
            bad(f"{where}.level_default: unknown level {level!r}")

    for i, pair in enumerate(block.get("rivalries") or []):
        if not (isinstance(pair, list) and len(pair) == 2):
            bad(f"rivalries[{i}]: must be a pair of program ids")
            continue
        for ref in pair:
            if ref not in ids:
                bad(f"rivalries[{i}]: unknown program {ref!r}")

    used: set[str] = set()
    for i, src in enumerate(block.get("sources") or []):
        where = f"sources[{i}]"
        if not isinstance(src, dict):
            bad(f"{where}: must be an object")
            continue
        for key in sorted(set(src) - _SOURCE):
            bad(f"{where}.{key}: unknown key")
        name = src.get("adapter")
        if name not in adapters.names():
            bad(f"{where}.adapter: unknown adapter {name!r}; registered: {', '.join(adapters.names()) or '(none)'}")
        else:
            used.add(name)
        if "program" in src and src["program"] not in ids:
            bad(f"{where}.program: unknown program {src['program']!r}")
        if "sport" in src and src["sport"] not in registry.sports():
            bad(f"{where}.sport: unknown sport {src['sport']!r}")
        if "level" in src and src["level"] not in registry.levels():
            bad(f"{where}.level: unknown level {src['level']!r}")
        if "gender" in src and src["gender"] not in registry.genders():
            bad(f"{where}.gender: unknown gender {src['gender']!r}")
        if "robots_mode" in src and src["robots_mode"] not in robots.MODES:
            bad(f"{where}.robots_mode: expected one of {', '.join(robots.MODES)}")
        if "params" in src and not isinstance(src["params"], dict):
            bad(f"{where}.params: must be an object")

    priority = block.get("source_priority")
    if priority is not None:
        if not isinstance(priority, list) or len(set(map(str, priority))) != len(priority):
            bad("source_priority: must be a list without repeats")
        else:
            allowed = set(adapters.names()) | set(NON_ADAPTER_SOURCES)
            for name in priority:
                if name not in allowed:
                    bad(f"source_priority: unknown source {name!r}")
            for name in sorted(used - set(priority)):
                bad(f"source_priority: missing adapter {name!r} that sources use")

    subs = block.get("submissions")
    if subs is not None and not (isinstance(subs, dict) and set(subs) <= {"enabled"} and isinstance(subs.get("enabled"), bool)):
        bad("submissions: must be {enabled: true|false}")
    return p
