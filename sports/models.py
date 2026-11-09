"""Normalized shapes every adapter returns. Adapters never know which town they run for."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sports import registry

STATUSES = ("scheduled", "final", "postponed", "cancelled")


@dataclass
class NormalizedEvent:
    source: str                       # adapter name, e.g. 'ics'
    source_uid: str                   # stable id within the source
    sport: str
    level: str
    start_at: datetime                # timezone-aware; stored as UTC
    tz: str                           # IANA name of the venue's local zone
    program_id: str | None = None     # the config program this row belongs to
    gender: str | None = None
    competition: str | None = None
    home_program_id: str | None = None
    home_name: str | None = None
    away_program_id: str | None = None
    away_name: str | None = None
    venue: str | None = None
    status: str = "scheduled"
    score_home: int | None = None
    score_away: int | None = None
    placing_text: str | None = None
    url: str | None = None
    time_tba: bool = False            # the source gives no time: start_at is local midnight and must never be shown as a clock time
    neutral_site: bool = False        # neither side is at home; home/away only orders the two sides and the score
    exhibition: bool = False          # the source says "(Exhibition)" or "Scrimmage" outright; shown, never counted in a record or standings

    @property
    def result_type(self) -> str:
        return registry.result_type(self.sport)

    def problems(self) -> list[str]:
        out: list[str] = []
        known_sport = self.sport in registry.sports()
        if not known_sport:
            out.append(f"unknown sport {self.sport!r}")
        if self.level not in registry.levels():
            out.append(f"unknown level {self.level!r}")
        if self.gender is not None and self.gender not in registry.genders():
            out.append(f"unknown gender {self.gender!r}")
        if self.status not in STATUSES:
            out.append(f"unknown status {self.status!r}")
        if self.start_at.tzinfo is None:
            out.append("start_at has no timezone")
        two_sided = (self.home_program_id or self.home_name) and (self.away_program_id or self.away_name)
        if known_sport and registry.result_type(self.sport) == "score" and not two_sided:
            out.append("a score sport needs both a home and an away side")
        if (self.score_home is None) != (self.score_away is None):
            out.append("score_home and score_away must both be set or both be empty")
        return out


class Fetched(list):
    """What an adapter may return instead of a plain list: the events it read, plus `unread` -- the scopes (program, sport, gender) whose page or
    file it could not read this time, each with a short reason. The runner writes the events, warns about the unread scopes and leaves their
    rows exactly as they were (no missed_runs, no withdrawal; sports/withdraw.py). An adapter that reads nothing at all raises instead."""

    def __init__(self, events=(), unread=()):
        super().__init__(events)
        self.unread: list[dict] = list(unread)


@dataclass
class NormalizedStanding:
    source: str
    competition: str
    season: str
    team_name: str
    as_of: date
    program_id: str | None = None
    rank: int | None = None
    played: int | None = None
    won: int | None = None
    drawn: int | None = None
    lost: int | None = None
    points: int | None = None
