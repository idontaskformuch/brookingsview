"""Validate a town's `sports` block. Any problem fails the build (tests/test_sports_config.py and `python -m sports.check --validate-all`)."""
from __future__ import annotations

import re

from scrapers import robots
from sports import adapters, registry, venues

NON_ADAPTER_SOURCES = ("manual_verified", "submissions")
_TOP = {"enabled", "collect", "nearby_radius_miles", "programs", "rivalries", "sources", "source_priority", "submissions",
        "register", "venues", "distance_origin"}
_PROGRAM = {"id", "name", "short", "nickname", "colors", "home_venue", "level_default", "kind",
            "group", "status", "sport", "gender", "link", "venue_overrides"}
# sports-deep (owner 2026-11-15): programs are teams WITH a source; `register` holds the rest (shown as a link or not at all, never
# written to sport_programs). group "around" = played outside the town and the team does not carry its name.
GROUPS = ("town", "around")
REGISTER_STATUSES = ("link", "awaiting_written_answer", "register_only")
_REGISTER = {"id", "name", "sport", "gender", "group", "status", "link", "waiting_on", "home_venue", "note"}
_VENUE = {"lat", "lon", "town", "source", "fetched"}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SOURCE = {"adapter", "program", "sport", "level", "gender", "url", "params", "robots_mode", "max_crawl_delay", "note"}
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
    if "collect" in block and not isinstance(block["collect"], bool):
        bad("collect: true or false (collect = the runner gathers rows; enabled = the site shows them)")
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
        if "kind" in prog and prog["kind"] != "club":
            bad(f"{where}.kind: only \"club\" is defined")
        level = prog.get("level_default")
        if level is not None and level not in registry.levels():
            bad(f"{where}.level_default: unknown level {level!r}")
        _check_team_fields(prog, where, bad)
        if "status" in prog and prog["status"] != "source":
            bad(f"{where}.status: a program has a source; link-only teams go in sports.register")
        if "venue_overrides" in prog:
            p.extend(f"{town}: sports.{m}" for m in venues.validate_overrides(prog["venue_overrides"], f"{where}.venue_overrides"))

    for i, entry in enumerate(block.get("register") or []):
        where = f"register[{i}]"
        if not isinstance(entry, dict):
            bad(f"{where}: must be an object")
            continue
        for key in sorted(set(entry) - _REGISTER):
            bad(f"{where}.{key}: unknown key")
        rid = entry.get("id")
        if not isinstance(rid, str) or not _SLUG.match(rid):
            bad(f"{where}.id: required lowercase slug")
        elif rid in ids:
            bad(f"{where}.id: duplicate {rid!r}")
        else:
            ids.add(rid)
        if not entry.get("name"):
            bad(f"{where}.name: required")
        if entry.get("status") not in REGISTER_STATUSES:
            bad(f"{where}.status: expected one of {', '.join(REGISTER_STATUSES)}")
        if entry.get("status") in ("link", "awaiting_written_answer") and not entry.get("link"):
            bad(f"{where}.link: required for status {entry.get('status')}")
        if entry.get("status") == "awaiting_written_answer" and not entry.get("waiting_on"):
            bad(f"{where}.waiting_on: say whose written answer")
        if not entry.get("sport"):
            bad(f"{where}.sport: required")
        _check_team_fields(entry, where, bad)

    places = block.get("venues")
    if places is not None:
        if not isinstance(places, dict):
            bad("venues: must be an object {name: {lat, lon, town, source, fetched}}")
            places = {}
        for name, v in places.items():
            if not isinstance(v, dict) or set(v) != _VENUE:
                bad(f"venues[{name!r}]: needs exactly {', '.join(sorted(_VENUE))}")
                continue
            # null/null = no coordinates found (owner 2026-11-15): the town is shown, no distance.
            if not (v["lat"] is None and v["lon"] is None) and not all(
                    isinstance(v[k], (int, float)) and not isinstance(v[k], bool) for k in ("lat", "lon")):
                bad(f"venues[{name!r}]: lat and lon must both be numbers, or both null")
            if not (isinstance(v["town"], str) and v["town"].strip()):
                bad(f"venues[{name!r}].town: required")
            if not (isinstance(v["fetched"], str) and _DATE.match(v["fetched"])):
                bad(f"venues[{name!r}].fetched: YYYY-MM-DD")
    origin = block.get("distance_origin")
    if origin is not None and origin not in (places or {}):
        bad(f"distance_origin: {origin!r} is not in sports.venues")
    elif origin is not None and isinstance(places[origin], dict) and places[origin].get("lat") is None:
        bad(f"distance_origin: {origin!r} has no coordinates")

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
        mcd = src.get("max_crawl_delay")
        if "max_crawl_delay" in src and (isinstance(mcd, bool) or not isinstance(mcd, (int, float)) or mcd <= 0):
            bad(f"{where}.max_crawl_delay: must be a positive number of seconds")
        if "note" in src and not isinstance(src["note"], str):
            bad(f"{where}.note: must be text")
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


def _check_team_fields(entry: dict, where: str, bad) -> None:
    if "group" in entry and entry["group"] not in GROUPS:
        bad(f"{where}.group: expected one of {', '.join(GROUPS)}")
    if "sport" in entry and entry["sport"] not in registry.sports():
        bad(f"{where}.sport: unknown sport {entry['sport']!r}")
    if "gender" in entry and entry["gender"] not in registry.genders():
        bad(f"{where}.gender: unknown gender {entry['gender']!r}")
    if "link" in entry and not str(entry["link"]).startswith("https://"):
        bad(f"{where}.link: must be an https URL")
