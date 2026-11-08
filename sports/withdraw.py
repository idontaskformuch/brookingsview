"""Stale games: an UPCOMING game that its source stops listing is withdrawn (hidden), never deleted and never shown as cancelled.

A successful run of a source (no exception, no SourceSkipped) is compared with what the table holds for that source and program:

* a missing game gets missed_runs + 1 and is withdrawn when that reaches KARENS (two successful runs in a row, owner 2026-11-08);
* a MOVED game is withdrawn at once: a returned game that is new to the table has the same sport, gender, opponent and home/away side as the
  missing one (each new game replaces at most one missing one);
* the upsert (sports/store.py) clears withdrawn_at and resets missed_runs when the source lists the game again.

Guards, per scope (program, sport, gender) -- a scope with nothing to compare against changes nothing and says so:
* the source returned no game of the scope while the table has upcoming ones: broken or empty answer, nothing is touched;
* from MIN_SCOPE_ROWS (8) upcoming rows, more than MASS_MISS (50 %) of them missing: looks like a broken source, nothing is touched;
* from MIN_SCOPE_ROWS upcoming rows, a run may withdraw at most CAP (25 %) of them; above that the scope is left alone.
Below MIN_SCOPE_ROWS only the karens and the no-games guard apply (a scope of 2 rows where 1 disappears is withdrawn on the second run).

Only rows that are scheduled, not withdrawn and start after `now` are ever candidates: past games, games with a result and games in progress are never
touched. The decision is a pure function (plan) so it is tested without a database; load_known/apply do the SQL.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from sports.dedup import normalize_name
from sports.models import NormalizedEvent

KARENS = 2
MIN_SCOPE_ROWS = 8
MASS_MISS = 0.5
CAP = 0.25


@dataclass
class Known:
    id: int
    source_uid: str
    program_id: str | None
    sport: str
    gender: str | None
    start_at: datetime
    status: str
    withdrawn: bool
    missed_runs: int
    home_program_id: str | None
    home_name: str | None
    away_program_id: str | None
    away_name: str | None


@dataclass
class Plan:
    withdraw: list[int] = field(default_factory=list)
    missed: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _key(program, sport, gender, home_pid, home_name, away_pid, away_name) -> tuple:
    """(program, sport, gender, our side, opponent): what makes a new game 'the same game, moved'."""
    if program and home_pid == program:
        side, opponent = "home", away_pid or normalize_name(away_name)
    elif program and away_pid == program:
        side, opponent = "away", home_pid or normalize_name(home_name)
    else:
        side, opponent = "?", away_pid or normalize_name(away_name)
    return (program, sport, gender, side, opponent)


def _known_key(k: Known) -> tuple:
    return _key(k.program_id, k.sport, k.gender, k.home_program_id, k.home_name, k.away_program_id, k.away_name)


def _event_key(e: NormalizedEvent) -> tuple:
    return _key(e.program_id, e.sport, e.gender, e.home_program_id, e.home_name, e.away_program_id, e.away_name)


def plan(known: list[Known], returned: list[NormalizedEvent], now: datetime) -> Plan:
    out = Plan()
    seen = {e.source_uid for e in returned}
    table_uids = {k.source_uid for k in known}
    candidates = [k for k in known if k.status == "scheduled" and not k.withdrawn and k.start_at > now]
    new_games = Counter(_event_key(e) for e in returned if e.source_uid not in table_uids)
    scopes: dict[tuple, list[Known]] = {}
    for k in candidates:
        scopes.setdefault((k.program_id, k.sport, k.gender), []).append(k)

    for (program, sport, gender), rows in sorted(scopes.items(), key=lambda kv: str(kv[0])):
        label = f"{program}/{sport}/{gender or '-'}"
        missing = sorted((k for k in rows if k.source_uid not in seen), key=lambda k: (k.start_at, k.id))
        if not missing:
            continue
        if not any(e.program_id == program and e.sport == sport and e.gender == gender for e in returned):
            out.warnings.append(f"{label}: the source returned no games but {len(rows)} upcoming rows exist; nothing withdrawn")
            continue
        big = len(rows) >= MIN_SCOPE_ROWS
        if big and len(missing) / len(rows) > MASS_MISS:
            out.warnings.append(f"{label}: {len(missing)} of {len(rows)} upcoming games are missing at once (more than {MASS_MISS:.0%}); nothing withdrawn")
            continue
        due: list[Known] = []
        waiting: list[Known] = []
        for k in missing:
            key = _known_key(k)
            if new_games[key] > 0:  # moved: a new game for the same opponent and side took its place
                new_games[key] -= 1
                due.append(k)
            elif k.missed_runs + 1 >= KARENS:
                due.append(k)
            else:
                waiting.append(k)
        if big and len(due) > len(rows) * CAP:
            out.warnings.append(f"{label}: {len(due)} of {len(rows)} upcoming games would be withdrawn in one run (cap {CAP:.0%}); nothing withdrawn")
            continue
        out.withdraw += [k.id for k in due]
        out.missed += [k.id for k in waiting]
    return out


_COLS = ("id", "source_uid", "program_id", "sport", "gender", "start_at", "status", "withdrawn_at", "missed_runs",
         "home_program_id", "home_name", "away_program_id", "away_name")


def load_known(cur, town_id: str, source: str, program_ids: list[str]) -> list[Known]:
    """Every row of the source and programs, any status (the 'new to the table' test needs them all). Run BEFORE the upsert."""
    if not program_ids:
        return []
    cur.execute(f"SELECT {', '.join(_COLS)} FROM sport_events WHERE town_id = %s AND source = %s AND program_id = ANY(%s)",
                (town_id, source, list(program_ids)))
    return [Known(id=r["id"], source_uid=r["source_uid"], program_id=r["program_id"], sport=r["sport"], gender=r["gender"], start_at=r["start_at"],
                  status=r["status"], withdrawn=r["withdrawn_at"] is not None, missed_runs=r["missed_runs"],
                  home_program_id=r["home_program_id"], home_name=r["home_name"], away_program_id=r["away_program_id"], away_name=r["away_name"])
            for r in cur.fetchall()]


def apply(cur, p: Plan) -> None:
    if p.withdraw:
        cur.execute("UPDATE sport_events SET withdrawn_at = now(), missed_runs = missed_runs + 1 WHERE id = ANY(%s)", (p.withdraw,))
    if p.missed:
        cur.execute("UPDATE sport_events SET missed_runs = missed_runs + 1 WHERE id = ANY(%s)", (p.missed,))
