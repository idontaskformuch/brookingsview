"""Country / nation profile layer, Python side (Glasgow Phase 1).

Reads the SAME files the site reads (config/countries/{us,gb}.json), so the
two languages cannot drift. A town config without a "country" key is a US
town -- the pre-profile behaviour, which must stay byte-identical.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).resolve().parent / "countries"


@lru_cache(maxsize=None)
def load_country(country_id: str) -> dict:
    path = _DIR / f"{country_id}.json"
    if not path.exists():
        raise ValueError(f"unknown country profile: {country_id!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def country_of(cfg: dict | None) -> str:
    return (cfg or {}).get("country", "us")


def profile_for(cfg: dict | None) -> dict:
    return load_country(country_of(cfg))


def is_us(cfg: dict | None) -> bool:
    return country_of(cfg) == "us"


def validate_place_config(cfg: dict) -> list[str]:
    """us town: needs state. gb town: needs region + a known nation."""
    town = cfg.get("town_id", "?")
    try:
        profile = profile_for(cfg)
    except ValueError as exc:
        return [f"{town}: {exc}"]
    problems: list[str] = []
    if profile["regionRequired"]:
        if not cfg.get("state"):
            problems.append(f"{town}: state is required for country {profile['id']}")
    else:
        if not cfg.get("region"):
            problems.append(f"{town}: region is required for country {profile['id']}")
        nation = cfg.get("nation")
        if not nation:
            problems.append(f"{town}: nation is required for country {profile['id']}")
        elif nation not in profile["nations"]:
            problems.append(f"{town}: unknown nation {nation!r} for country {profile['id']}")
    return problems
