"""Per-country sports wording from strings/<country>/sports.json. Missing placeholders raise: text comes from templates only, never from a model."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).resolve().parent.parent / "strings"


@lru_cache(maxsize=None)
def load(country: str) -> dict:
    path = _DIR / country / "sports.json"
    if not path.is_file():
        raise ValueError(f"no sports strings for country {country!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def term(country: str, key: str) -> str:
    return load(country)["terms"][key]


def render(country: str, template: str, **values) -> str:
    return load(country)["templates"][template].format(**values)
