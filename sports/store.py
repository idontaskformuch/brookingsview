"""Persistence for the sports tables. Writes go through db.get_conn(), so the prod write guard (CLAUDE.md rule 14) applies unchanged."""
from __future__ import annotations

from datetime import datetime, timezone

from sports.models import NormalizedEvent

_EVENT_COLS = ("program_id", "sport", "level", "gender", "competition", "home_program_id", "home_name", "away_program_id", "away_name",
               "start_at", "tz", "venue", "status", "result_type", "score_home", "score_away", "placing_text", "url", "time_tba", "neutral_site")


def sync_programs(cur, town_id: str, block: dict) -> None:
    rivals: dict[str, list[str]] = {}
    for a, b in block.get("rivalries") or []:
        rivals.setdefault(a, []).append(b)
        rivals.setdefault(b, []).append(a)
    for prog in block.get("programs") or []:
        colors = prog.get("colors") or [None, None]
        cur.execute(
            """INSERT INTO sport_programs (town_id, id, name, short, nickname, color_primary, color_secondary, home_venue, level_default, rival_ids)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (town_id, id) DO UPDATE SET name=EXCLUDED.name, short=EXCLUDED.short, nickname=EXCLUDED.nickname,
                 color_primary=EXCLUDED.color_primary, color_secondary=EXCLUDED.color_secondary, home_venue=EXCLUDED.home_venue,
                 level_default=EXCLUDED.level_default, rival_ids=EXCLUDED.rival_ids""",
            (town_id, prog["id"], prog["name"], prog.get("short"), prog.get("nickname"), colors[0], colors[1],
             prog.get("home_venue"), prog.get("level_default"), rivals.get(prog["id"], [])))


def upsert_events(cur, town_id: str, events: list[NormalizedEvent]) -> int:
    """Insert or update by (town_id, source, source_uid). first_seen is kept, last_seen moves. Rows are never deleted."""
    placeholders = ",".join(["%s"] * (len(_EVENT_COLS) + 3))
    updates = ",".join(f"{c}=EXCLUDED.{c}" for c in _EVENT_COLS) + ",last_seen=now()"
    for ev in events:
        bad = ev.problems()
        if bad:
            raise ValueError(f"{ev.source}:{ev.source_uid}: {'; '.join(bad)}")
        values = [ev.result_type if c == "result_type" else getattr(ev, c) for c in _EVENT_COLS]
        cur.execute(
            f"INSERT INTO sport_events (town_id, source, source_uid, {','.join(_EVENT_COLS)}) VALUES ({placeholders}) "
            f"ON CONFLICT (town_id, source, source_uid) DO UPDATE SET {updates}",
            [town_id, ev.source, ev.source_uid, *values])
    return len(events)


def record_health(cur, town_id: str, source_id: str, *, event_count: int | None = None, error: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    if error is None:
        cur.execute(
            """INSERT INTO sport_sources_health (town_id, source_id, last_success, event_count) VALUES (%s,%s,%s,%s)
               ON CONFLICT (town_id, source_id) DO UPDATE SET last_success=EXCLUDED.last_success, event_count=EXCLUDED.event_count""",
            (town_id, source_id, now, event_count or 0))
    else:
        cur.execute(
            """INSERT INTO sport_sources_health (town_id, source_id, last_error, last_error_at) VALUES (%s,%s,%s,%s)
               ON CONFLICT (town_id, source_id) DO UPDATE SET last_error=EXCLUDED.last_error, last_error_at=EXCLUDED.last_error_at""",
            (town_id, source_id, error[:500], now))
