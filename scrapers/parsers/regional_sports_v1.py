"""Regionala pro-/MiLB-lag för städer utan ett eget lokalt lag att bevaka --
se configens data_sources.pro_sports.teams (en lista, en post per lag).

VARFÖR BARA MLB STATS API, INTE ESPN (ett tidigt utkast föreslog båda):
ESPN:s "hidden" scoreboard-JSON (site.api.espn.com) sitter bakom Akamais
bot-hantering -- verifierat live: ett anrop med en ärlig, identifierande
User-Agent (samma konvention som resten av den här kodbasen) blockeras rakt
av med 403 Access Denied direkt från Akamai (svarshuvud Server: AkamaiGHost),
medan ett anrop UTAN User-Agent alls släpps igenom. Att medvetet utelämna
identifiering specifikt FÖR ATT den ärliga varianten blockeras är samma sorts
kringgående i sak som att maskera sig som en webbläsare -- något den här
kodbasen konsekvent har avstått från mot andra Akamai-/WAF-skyddade källor
(se t.ex. civicengage_pdf_v1.py). Byggs alltså inte mot ESPN.

MLB Stats API (statsapi.mlb.com) är däremot en riktig, offentligt
dokumenterad API utan sådan blockering -- verifierat: 200 med samma ärliga
User-Agent, ingen robots.txt-begränsning (404, inget deklarerat), och en
explicit copyright-notis i svaret som pekar mot användarvillkor (ett
medvetet publikt erbjudande, inte en råkat öppen endpoint).

TÄCKNING: alla MLB-affilierade lag i configen (MLB-klubbar direkt via
sportId=1, eller en MiLB-klubb via sin egen sportId) går via denna endpoint
-- Inland Empire 66ers (Single-A, sportId=14, Seattle Mariners-affiliate,
team_id 401) och Angels/Dodgers (MLB, sportId=1, team_id 108/119) är alla
verifierade mot /api/v1/teams och byggda. NHL/NBA/NFL-lag (Ducks, Lakers,
Clippers, Rams, Chargers) har INGEN verifierad källa än -- de står i
configen som kind="unconfirmed" tills en motsvarande officiell,
icke-WAF-blockerad API hittas per liga. Den här parsern skippar dem tyst
(samma "unconfirmed"-hantering som events.py använder för overifierade
delkällor).

DEDUP/UPPDATERING: en matchs status/resultat ändras legitimt över tid
(scheduled -> live -> final) -- till skillnad från oföränderlig källdata som
möten/event/fastighetsförsäljningar. conflict_columns/update_columns (se
scrapers/base_parser.py) styr db.upsert_records() mot
ON CONFLICT (town_id, external_game_id) DO UPDATE i stället för
standardbeteendet DO NOTHING, så en omkörning uppdaterar en redan känd match
i stället för att strunta i den eller duplicera den.
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

DAYS_BACK = 3
DAYS_FORWARD = 7

_STATS_API = "https://statsapi.mlb.com/api/v1"

_STATUS_MAP = {
    "Scheduled": "scheduled", "Pre-Game": "scheduled", "Warmup": "scheduled",
    "In Progress": "live", "Manager Challenge": "live", "Delayed": "live",
    "Delayed Start": "scheduled",
    "Final": "final", "Game Over": "final", "Completed Early": "final",
    "Postponed": "postponed", "Suspended": "postponed", "Cancelled": "postponed",
}


class RegionalSportsParser(BaseParser):
    table = "regional_sports_games"
    platform = "mlb_statsapi"
    conflict_columns = ("town_id", "external_game_id")
    update_columns = ["status", "team_score", "opponent_score", "raw_data", "content_hash"]

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def _teams(self) -> list[dict]:
        """Bara lag med en riktig källa -- "unconfirmed"-lag (Ducks/Lakers/
        Clippers/Rams/Chargers i nuläget) hoppas tyst över, samma mönster som
        events.py använder för overifierade delkällor."""
        return [t for t in self.source_cfg.get("teams", []) if t.get("kind") == "mlb_statsapi"]

    def fetch(self) -> FetchResult:
        start = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
        end = (date.today() + timedelta(days=DAYS_FORWARD)).isoformat()

        payloads: dict[int, dict] = {}
        for team in self._teams():
            team_id = team["team_id"]
            r = requests.get(
                f"{_STATS_API}/schedule",
                params={"teamId": team_id, "startDate": start, "endDate": end, "sportId": team["sport_id"]},
                headers=self._headers(), timeout=20,
            )
            r.raise_for_status()
            payloads[team_id] = r.json()

        self._payloads = payloads
        raw = json.dumps(payloads, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=f"{_STATS_API}/schedule", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        payloads = getattr(self, "_payloads", None)
        if payloads is None:
            # JSON-objektnycklar är alltid strängar -- gör om till int så
            # uppslaget mot team["team_id"] (int, från configen) fungerar.
            payloads = {int(k): v for k, v in json.loads(fetched.raw.decode("utf-8")).items()}

        out: list[dict] = []
        for team in self._teams():
            payload = payloads.get(team["team_id"])
            if not payload:
                continue
            out.extend(self._parse_team_games(payload, team))
        return out

    def _parse_team_games(self, payload: dict, team: dict) -> list[dict]:
        rows = []
        for date_block in payload.get("dates", []):
            for game in date_block.get("games", []):
                teams = game["teams"]
                is_home = teams["home"]["team"]["id"] == team["team_id"]
                us = teams["home"] if is_home else teams["away"]
                them = teams["away"] if is_home else teams["home"]

                external_game_id = str(game["gamePk"])
                status = _STATUS_MAP.get(game["status"]["detailedState"], "scheduled")
                team_score = us.get("score")
                opponent_score = them.get("score")

                rows.append({
                    "league": team["league"],
                    "team_name": team["team_name"],
                    "team_abbr": team.get("team_abbr"),
                    "opponent_name": them["team"]["name"],
                    "home_away": "home" if is_home else "away",
                    "game_date": game.get("officialDate"),
                    "game_time_utc": game.get("gameDate"),
                    "status": status,
                    "team_score": team_score,
                    "opponent_score": opponent_score,
                    "venue": (game.get("venue") or {}).get("name"),
                    "relevance_tier": team.get("relevance_tier", "secondary"),
                    "source": "mlb_statsapi",
                    "external_game_id": external_game_id,
                    "raw_data": game,
                    # resultatet är MEDVETET med i hashen (till skillnad från
                    # t.ex. legistar_v1) -- den här tabellens content_hash är
                    # bara ett revisionsspår, inte konfliktmålet (se
                    # conflict_columns ovan), så det ska ändras när status/
                    # resultat ändras.
                    "content_hash": content_hash(
                        "regional_sports", external_game_id, status, team_score, opponent_score,
                    ),
                })
        return rows
