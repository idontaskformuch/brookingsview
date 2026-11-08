"""Cross-source dedup on (program, sport, level, gender, local date, normalized opponent). Source priority comes from the town config."""
from __future__ import annotations

import re
from zoneinfo import ZoneInfo

from sports.models import NormalizedEvent

_NOISE = re.compile(r"\b(high school|hs|vs|at|the|jv|varsity|boys|girls)\b")


def normalize_name(name: str | None) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", (name or "").lower())
    text = _NOISE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def opponent_of(ev: NormalizedEvent) -> str:
    """The side that is not the event's own program; falls back to the away side."""
    if ev.program_id and ev.home_program_id == ev.program_id:
        return ev.away_program_id or normalize_name(ev.away_name)
    if ev.program_id and ev.away_program_id == ev.program_id:
        return ev.home_program_id or normalize_name(ev.home_name)
    return ev.away_program_id or normalize_name(ev.away_name)


def dedup_key(ev: NormalizedEvent) -> tuple:
    local_date = ev.start_at.astimezone(ZoneInfo(ev.tz)).date()
    return (ev.program_id, ev.sport, ev.level, ev.gender, local_date, normalize_name(opponent_of(ev)))


def dedup(events: list[NormalizedEvent], priority: list[str]) -> list[NormalizedEvent]:
    """Keep one event per key: the source first in `priority` (unlisted sources rank last). First seen wins ties."""
    rank = {name: i for i, name in enumerate(priority)}
    best: dict[tuple, NormalizedEvent] = {}
    for ev in events:
        key = dedup_key(ev)
        cur = best.get(key)
        if cur is None or rank.get(ev.source, len(rank)) < rank.get(cur.source, len(rank)):
            best[key] = ev
    return list(best.values())
