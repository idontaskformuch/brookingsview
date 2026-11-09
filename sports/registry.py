"""Sport registry, read from config/sports.json (the same file scripts/gen_sports_registry.py turns into the TS mirror)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_FILE = Path(__file__).resolve().parent.parent / "config" / "sports.json"


class UnknownSportError(ValueError):
    pass


@lru_cache(maxsize=None)
def _doc() -> dict:
    return json.loads(_FILE.read_text(encoding="utf-8"))


def sports() -> dict[str, dict]:
    return {s["id"]: s for s in _doc()["sports"]}


def levels() -> tuple[str, ...]:
    return tuple(_doc()["levels"])


def genders() -> tuple[str, ...]:
    return tuple(_doc()["genders"])


def result_types() -> tuple[str, ...]:
    return tuple(_doc()["resultTypes"])


def sport(sport_id: str) -> dict:
    found = sports().get(sport_id)
    if found is None:
        raise UnknownSportError(f"unknown sport id {sport_id!r}; known: {', '.join(sorted(sports()))}")
    return found


def sport_label(sport_id: str, country: str = "us") -> str:
    return sport(sport_id)["uk" if country == "gb" else "us"]


def no_redistribution() -> tuple[str, ...]:
    """Sources (sport_events.source) whose terms forbid redistributing the raw data: pages only, never an ICS/JSON/RSS export."""
    return tuple(_doc().get("noRedistribution", ()))


def redistributable(source: str) -> bool:
    return source not in no_redistribution()


def result_type(sport_id: str) -> str:
    return sport(sport_id)["result_type"]


def duration_hours(sport_id: str) -> float:
    """How long a game of this sport counts as upcoming after it starts; mirrors sportDurationHours in the TS registry."""
    return sport(sport_id).get("typical_duration_hours", _doc()["defaultDurationHours"])
