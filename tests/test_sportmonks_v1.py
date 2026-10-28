"""Sportmonks adapter -- real 2026-10-28 Scottish Premiership responses (fixtures/between, includes participants;venue;scores;state;round)."""
import json
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pytest

from scrapers import runner
from scrapers.base_parser import FetchResult
from scrapers.parsers.sportmonks_v1 import STATUS, SportmonksParser

FIX = Path(__file__).parent / "fixtures"
SRC = {
    "type": "sportmonks", "league_id": 501, "league_label": "premiership",
    "tracked_teams": [
        {"team_id": 53, "team_name": "Celtic", "team_abbr": "CEL", "relevance_tier": "primary"},
        {"team_id": 62, "team_name": "Rangers", "team_abbr": "RAN", "relevance_tier": "primary"},
    ],
}
CFG = {"town_id": "glasgow", "timezone": "Europe/London"}


def _fixtures():
    recent = json.loads((FIX / "sportmonks_recent.json").read_text(encoding="utf-8"))["data"]
    upcoming = json.loads((FIX / "sportmonks_upcoming.json").read_text(encoding="utf-8"))["data"]
    return {f["id"]: f for f in [*recent, *upcoming]}.values()


def _rows(fixtures=None, src=SRC):
    parser = SportmonksParser(CFG, src)
    raw = json.dumps({"fixtures": list(fixtures if fixtures is not None else _fixtures())}).encode()
    return parser.parse(FetchResult(raw=raw))


def _by(rows, game):
    return next(r for r in rows if r["external_game_id"] == game)


def test_only_the_tracked_teams_get_rows_with_a_stable_id_per_team():
    rows = _rows()
    assert {r["team_name"] for r in rows} == {"Celtic", "Rangers"}
    ids = [r["external_game_id"] for r in rows]
    assert len(ids) == len(set(ids))
    assert all(r["source"] == "sportmonks" and r["relevance_tier"] == "primary" for r in rows)


def test_a_finished_match_has_the_full_time_score_from_the_teams_side():
    rows = _rows()
    rangers = next(r for r in rows if r["team_name"] == "Rangers" and r["opponent_name"] == "St. Johnstone")
    assert (rangers["status"], rangers["home_away"], rangers["team_score"], rangers["opponent_score"]) == ("final", "home", 4, 0)
    assert rangers["venue"] == "Ibrox Stadium"
    celtic = next(r for r in rows if r["team_name"] == "Celtic" and r["opponent_name"] == "Hibernian")
    assert (celtic["status"], celtic["home_away"], celtic["team_score"], celtic["opponent_score"]) == ("final", "away", 2, 1)


def test_an_upcoming_match_has_no_score_and_a_kickoff_in_london_time():
    rows = _rows()
    m = next(r for r in rows if r["team_name"] == "Celtic" and r["opponent_name"] == "Dundee United")
    assert (m["status"], m["team_score"], m["opponent_score"]) == ("scheduled", None, None)
    assert m["game_time_utc"].isoformat() == "2026-10-28T19:45:00+00:00"
    assert m["game_date"] == date(2026, 10, 28)
    assert m["home_away"] == "home"


def test_a_match_between_two_tracked_teams_gives_one_row_for_each():
    f = json.loads(json.dumps(next(iter(_fixtures()))))
    f["id"] = 999
    f["participants"] = [
        {"id": 53, "name": "Celtic", "short_code": "CEL", "meta": {"location": "home"}},
        {"id": 62, "name": "Rangers", "short_code": "RAN", "meta": {"location": "away"}},
    ]
    rows = _rows([f])
    assert sorted(r["external_game_id"] for r in rows) == ["999-53", "999-62"]
    assert {(r["team_name"], r["home_away"]) for r in rows} == {("Celtic", "home"), ("Rangers", "away")}


def test_stored_raw_data_is_trimmed_no_images_no_odds():
    row = _rows()[0]
    text = json.dumps(row["raw_data"])
    assert "image_path" not in text and "has_odds" not in text
    assert set(row["raw_data"]) >= {"fixture_id", "name", "state", "home", "away", "venue"}


def test_a_postponed_match_is_marked_postponed_and_never_shows_a_score():
    f = json.loads(json.dumps(next(iter(_fixtures()))))
    f["state"] = {"id": 10, "state": "POSTPONED", "name": "Postponed", "short_name": "POST", "developer_name": "POSTPONED"}
    f["participants"][0]["id"] = 53
    rows = _rows([f])
    assert rows and all(r["status"] == "postponed" and r["team_score"] is None for r in rows)


def test_an_unknown_state_is_skipped_not_guessed(capsys):
    f = json.loads(json.dumps(next(iter(_fixtures()))))
    f["state"] = {"developer_name": "SOMETHING_NEW"}
    assert _rows([f]) == []
    assert "okänt matchläge" in capsys.readouterr().out


def test_unknown_shapes_fail_closed():
    f = json.loads(json.dumps(next(iter(_fixtures()))))
    f["participants"] = f["participants"][:1]
    with pytest.raises(RuntimeError, match="hemma-/bortalag"):
        _rows([f])
    g = json.loads(json.dumps(next(iter(_fixtures()))))
    del g["starting_at_timestamp"]
    with pytest.raises(RuntimeError, match="starting_at_timestamp"):
        _rows([g])


def test_every_state_in_the_fixtures_is_mapped():
    states = {f["state"]["developer_name"] for f in _fixtures()}
    assert states <= set(STATUS), states - set(STATUS)


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


def test_fetch_sends_the_token_in_a_header_never_in_the_url(monkeypatch):
    monkeypatch.setenv("SPORTMONKS_API_KEY", "secret-token-123")
    seen = []

    def fake_get(url, params=None, headers=None, timeout=None):
        seen.append((url, params, headers))
        return _Resp({"data": list(_fixtures())[:2], "pagination": {"has_more": False}})

    monkeypatch.setattr("scrapers.parsers.sportmonks_v1.requests.get", fake_get)
    parser = SportmonksParser(CFG, SRC)
    parser._today = staticmethod(lambda: date(2026, 10, 28))
    result = parser.fetch()
    assert len(seen) == 2  # upcoming + recent, one page each
    for url, params, headers in seen:
        assert "secret-token-123" not in url and "api_token" not in json.dumps(params)
        assert headers["Authorization"] == "secret-token-123"
        assert params["filters"] == "fixtureLeagues:501"
    assert "secret-token-123" not in result.raw.decode()


def test_fetch_fails_on_http_errors_missing_data_missing_key_and_empty_windows(monkeypatch):
    parser = SportmonksParser(CFG, SRC)
    parser._today = staticmethod(lambda: date(2026, 10, 28))
    monkeypatch.delenv("SPORTMONKS_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SPORTMONKS_API_KEY"):
        parser.fetch()
    monkeypatch.setenv("SPORTMONKS_API_KEY", "k")
    for resp in (_Resp({}, 401), _Resp({"message": "no data key"}), _Resp({"data": "nope"})):
        monkeypatch.setattr("scrapers.parsers.sportmonks_v1.requests.get", lambda *a, _r=resp, **k: _r)
        with pytest.raises(RuntimeError):
            parser.fetch()
    monkeypatch.setattr("scrapers.parsers.sportmonks_v1.requests.get", lambda *a, **k: _Resp({"data": [], "pagination": {}}))
    with pytest.raises(RuntimeError, match="inga matcher"):
        parser.fetch()
    allow = SportmonksParser(CFG, {**SRC, "allow_empty": True})
    allow._today = staticmethod(lambda: date(2026, 10, 28))
    assert json.loads(allow.fetch().raw)["fixtures"] == []


def test_it_is_registered_and_glasgows_config_tracks_celtic_and_rangers_but_stays_disabled():
    assert "sportmonks" in runner.REGISTRY
    cfg = json.loads((Path(__file__).parent.parent / "configs" / "glasgow.json").read_text(encoding="utf-8"))
    src = cfg["data_sources"]["sports"]
    assert src["type"] == "sportmonks" and src["enabled"] is False
    assert {t["team_id"] for t in src["tracked_teams"]} == {53, 62}


def test_a_disabled_source_never_reaches_the_api(monkeypatch, tmp_path):
    cfg = {"town_id": "glasgow", "display_name": "Glasgow", "data_sources": {"sports": {"type": "sportmonks", "enabled": False}}}
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")

    @contextmanager
    def fake_conn():
        yield object()

    monkeypatch.setattr(runner.db, "get_conn", fake_conn)
    monkeypatch.setattr(runner.db, "ensure_town", lambda *a, **k: None)
    monkeypatch.setattr(runner, "run_source", lambda *a, **k: (_ for _ in ()).throw(AssertionError("a disabled source ran")))
    monkeypatch.setattr("sys.argv", ["runner", "--config", str(path)])
    assert runner.main() == 0
