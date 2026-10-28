"""Sportmonks Football API v3 -- the Scottish Premiership for Glasgow (Celtic, Rangers). Spec: .claude/specs/glasgow-sportmonks.md.

Verified 2026-10-28 with SPORTMONKS_API_KEY (header "Authorization: <token>", never in a URL or a log):
    GET https://api.sportmonks.com/v3/football/leagues                       -> the free plan's leagues: Premiership (501),
        Premiership Play-Offs (513), Danish Superliga (271) and its play-offs. Plans: "Football Free Plan", "Cricket Free Plan".
    GET .../fixtures/between/{from}/{to}?include=participants;venue;scores;state;round&filters=fixtureLeagues:501
        -> 200, `rate_limit.remaining` counts down from 180 per hour per entity; every include above is allowed on the free plan.
Times (`starting_at`, `starting_at_timestamp`) are UTC; scores come as one entry per half plus a "CURRENT" entry (the full-time score).
States seen: NS (not started), FT, POSTPONED. Docs: https://docs.sportmonks.com/v3

Output: one `regional_sports_games` row per TRACKED team per fixture (config `tracked_teams`), the same table and conflict target as
regional_sports_v1 (UNIQUE town_id + external_game_id, which here is "<fixture id>-<team id>" so a Celtic-Rangers match gives two rows).
Rows are updated in place as status and score change.

Fail closed (spec): an HTTP error, a body that is not the known shape (no `data` list) or an unknown fixture shape raises, and nothing
is written. Both windows empty also raises unless the source config says `"allow_empty": true` (close season). A fixture in a state
this file does not know is skipped with a printed warning, never guessed.

Stored `raw_data` is a trimmed copy (ids, names, times, venue, state, round, the full-time score): no image URLs, no odds flags.
Terms: the free plan lists public football websites among its use cases, but the docs do not say whether commercial use (ads) is
covered or whether attribution is required -- the owner confirms the licence in the Sportmonks account before the sports pages go live
(configs/glasgow.json keeps sports.enabled=false until then). Credit line when shown: "Data: Sportmonks".
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

API = "https://api.sportmonks.com/v3/football"
INCLUDES = "participants;venue;scores;state;round"
DAYS_BACK = 7
DAYS_FORWARD = 14
PER_PAGE = 50
MAX_PAGES = 3

# state.developer_name -> our status
STATUS = {
    "NS": "scheduled", "TBA": "scheduled", "PENDING": "scheduled",
    "INPLAY_1ST_HALF": "live", "HT": "live", "INPLAY_2ND_HALF": "live", "BREAK": "live", "INPLAY_ET": "live",
    "INPLAY_ET_2ND_HALF": "live", "INPLAY_PENALTIES": "live", "EXTRA_TIME_BREAK": "live", "PEN_BREAK": "live", "DELAYED": "live",
    "FT": "final", "AET": "final", "FT_PEN": "final", "AWARDED": "final", "WO": "final",
    "POSTPONED": "postponed", "CANCELLED": "postponed", "SUSPENDED": "postponed", "INTERRUPTED": "postponed", "ABANDONED": "postponed",
}


def _full_time_goals(scores: list[dict]) -> dict[str, int]:
    """{"home": n, "away": n} from the CURRENT score entries, or {} when there are none (not started)."""
    out: dict[str, int] = {}
    for s in scores or []:
        if s.get("description") == "CURRENT":
            side = (s.get("score") or {}).get("participant")
            goals = (s.get("score") or {}).get("goals")
            if side in ("home", "away") and isinstance(goals, int):
                out[side] = goals
    return out


class SportmonksParser(BaseParser):
    table = "regional_sports_games"
    platform = "sportmonks"
    conflict_columns = ("town_id", "external_game_id")
    update_columns = ["status", "team_score", "opponent_score", "game_date", "game_time_utc", "venue", "raw_data", "content_hash"]

    #: tests replace this
    _today = staticmethod(lambda: datetime.now(timezone.utc).date())

    def _token(self) -> str:
        key = os.environ.get("SPORTMONKS_API_KEY")
        if not key:
            raise RuntimeError("SPORTMONKS_API_KEY saknas i miljön")
        return key

    def _get(self, path: str, params: dict) -> dict:
        r = requests.get(f"{API}/{path}", params=params,
                         headers={"Authorization": self._token(), "Accept": "application/json", "User-Agent": user_agent(self.town_id)},
                         timeout=30)
        r.raise_for_status()
        doc = r.json()
        if not isinstance(doc, dict) or not isinstance(doc.get("data"), list):
            raise RuntimeError(f"Sportmonks {path}: okänd svarsform (ingen data-lista)")
        return doc

    def _window(self, start: date, end: date) -> list[dict]:
        league = int(self.source_cfg.get("league_id", 501))
        fixtures: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            doc = self._get(f"fixtures/between/{start}/{end}",
                            {"include": INCLUDES, "filters": f"fixtureLeagues:{league}", "per_page": PER_PAGE, "page": page})
            fixtures.extend(doc["data"])
            if not (doc.get("pagination") or {}).get("has_more"):
                break
        return fixtures

    def fetch(self) -> FetchResult:
        today = self._today()
        upcoming = self._window(today, today + timedelta(days=self.source_cfg.get("days_forward", DAYS_FORWARD)))
        recent = self._window(today - timedelta(days=self.source_cfg.get("days_back", DAYS_BACK)), today)
        if not upcoming and not recent and not self.source_cfg.get("allow_empty", False):
            raise RuntimeError("Sportmonks: inga matcher i något av fönstren (sätt allow_empty i configen under uppehåll)")
        by_id = {f["id"]: f for f in [*recent, *upcoming] if isinstance(f, dict) and "id" in f}
        raw = json.dumps({"fixtures": list(by_id.values())}, ensure_ascii=False).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=f"{API}/fixtures/between", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        fixtures = json.loads(fetched.raw.decode("utf-8")).get("fixtures", [])
        tracked = {int(t["team_id"]): t for t in self.source_cfg.get("tracked_teams", [])}
        tz = ZoneInfo(self.cfg.get("timezone", "Europe/London"))
        rows: list[dict] = []
        for fx in fixtures:
            parts = {(p.get("meta") or {}).get("location"): p for p in fx.get("participants") or []}
            if "home" not in parts or "away" not in parts:
                raise RuntimeError(f"Sportmonks fixture {fx.get('id')}: saknar hemma-/bortalag (okänd form)")
            state = (fx.get("state") or {}).get("developer_name")
            status = STATUS.get(state)
            if status is None:
                print(f"  [sportmonks] okänt matchläge {state!r} för {fx.get('name')!r} -- hoppar över")
                continue
            ts = fx.get("starting_at_timestamp")
            if not isinstance(ts, int):
                raise RuntimeError(f"Sportmonks fixture {fx.get('id')}: starting_at_timestamp saknas")
            kickoff = datetime.fromtimestamp(ts, timezone.utc)
            goals = _full_time_goals(fx.get("scores"))
            trimmed = {
                "fixture_id": fx.get("id"), "name": fx.get("name"), "starting_at_utc": kickoff.isoformat(),
                "league_id": fx.get("league_id"), "state": state, "result_info": fx.get("result_info"),
                "round": (fx.get("round") or {}).get("name"), "venue": (fx.get("venue") or {}).get("name"),
                "home": {"id": parts["home"]["id"], "name": parts["home"]["name"], "goals": goals.get("home")},
                "away": {"id": parts["away"]["id"], "name": parts["away"]["name"], "goals": goals.get("away")},
            }
            for side, other in (("home", "away"), ("away", "home")):
                us = parts[side]
                cfg = tracked.get(int(us["id"]))
                if cfg is None:
                    continue
                them = parts[other]
                team_score, opp_score = goals.get(side), goals.get(other)
                external_id = f"{fx['id']}-{us['id']}"
                rows.append({
                    "league": self.source_cfg.get("league_label", "premiership"),
                    "team_name": cfg.get("team_name") or us["name"],
                    "team_abbr": cfg.get("team_abbr") or us.get("short_code"),
                    "opponent_name": them["name"],
                    "home_away": side,
                    "game_date": kickoff.astimezone(tz).date(),
                    "game_time_utc": kickoff,
                    "status": status,
                    "team_score": team_score if status in ("live", "final") else None,
                    "opponent_score": opp_score if status in ("live", "final") else None,
                    "venue": (fx.get("venue") or {}).get("name"),
                    "relevance_tier": cfg.get("relevance_tier", "primary"),
                    "source": "sportmonks",
                    "external_game_id": external_id,
                    "raw_data": trimmed,
                    # the result is in the hash on purpose: it is a revision trail, the conflict target is external_game_id
                    "content_hash": content_hash("sportmonks", external_id, status, team_score, opp_score, kickoff.isoformat()),
                })
        return rows
