"""sports/withdraw.py: an upcoming game its source stops listing is withdrawn after two successful runs (at once when moved), with guards."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts import apply_migration
from sports import adapters, runner, store, withdraw
from sports.http import SourceSkipped
from sports.models import NormalizedEvent
from sports.withdraw import Known

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
P = "sdsu"


def known(i, opp, days=10, *, sport="football", gender="men", home=True, missed=0, status="scheduled", withdrawn=False, uid=None, start=None):
    us = ({"home_program_id": P, "home_name": None, "away_program_id": None, "away_name": opp} if home
          else {"home_program_id": None, "home_name": opp, "away_program_id": P, "away_name": None})
    return Known(id=i, source_uid=uid or f"u{i}", program_id=P, sport=sport, gender=gender, start_at=start or NOW + timedelta(days=days),
                 status=status, withdrawn=withdrawn, missed_runs=missed, **us)


def event(k: Known, *, uid=None, days=0, opp=None) -> NormalizedEvent:
    home = k.home_program_id == P
    name = opp or (k.away_name if home else k.home_name)
    us, them = ({"home_program_id": P}, {"away_name": name}) if home else ({"away_program_id": P}, {"home_name": name})
    return NormalizedEvent(source="internal", source_uid=uid or k.source_uid, sport=k.sport, level="college", gender=k.gender, program_id=P,
                           tz="America/Chicago", start_at=k.start_at + timedelta(days=days), **us, **them)


def test_a_scope_of_two_where_one_disappears_is_withdrawn_on_the_second_run_not_the_first():
    a, b = known(1, "Alpha"), known(2, "Beta", 20)
    first = withdraw.plan([a, b], [event(a)], NOW)
    assert (first.withdraw, first.missed, first.warnings) == ([], [2], [])
    b.missed_runs = 1  # what the first run stored
    second = withdraw.plan([a, b], [event(a)], NOW)
    assert (second.withdraw, second.missed) == ([2], [])


def test_nothing_missing_changes_nothing():
    a, b = known(1, "Alpha"), known(2, "Beta", 20)
    assert withdraw.plan([a, b], [event(a), event(b)], NOW) == withdraw.Plan()


def test_a_moved_game_is_withdrawn_at_once_when_a_new_row_has_the_same_opponent_and_side():
    old, other = known(1, "Alpha"), known(2, "Beta", 20)
    moved = event(old, uid="u1-new", days=7)  # new source_uid (the date is part of it), same opponent, same side
    p = withdraw.plan([old, other], [moved, event(other)], NOW)
    assert (p.withdraw, p.missed) == ([1], [])


def test_a_new_row_for_another_opponent_other_side_or_other_sport_does_not_trigger_the_shortcut():
    old, other = known(1, "Alpha"), known(2, "Beta", 20)
    assert withdraw.plan([old, other], [event(other), event(known(9, "Gamma"), uid="new")], NOW).withdraw == []
    assert withdraw.plan([old, other], [event(other), event(known(9, "Alpha", home=False), uid="new")], NOW).withdraw == []
    other_sport = event(known(9, "Alpha", sport="volleyball", gender="women"), uid="new")
    assert withdraw.plan([old, other], [event(other), other_sport], NOW).withdraw == []


def test_each_new_game_replaces_at_most_one_missing_one():
    a, b = known(1, "Alpha", 10), known(2, "Alpha", 11)  # a two-game series
    keep = known(3, "Beta", 20)
    p = withdraw.plan([a, b, keep], [event(a, uid="new-a", days=7), event(keep)], NOW)
    assert p.withdraw == [1] and p.missed == [2]


def test_no_games_returned_for_a_scope_touches_nothing_and_warns():
    a, b = known(1, "Alpha"), known(2, "Beta", 20, missed=1)
    other = known(3, "Gamma", sport="volleyball", gender="women")
    p = withdraw.plan([a, b, other], [event(other)], NOW)
    assert p.withdraw == [] and p.missed == [] and "returned no games" in p.warnings[0]
    assert withdraw.plan([a, b], [], NOW).withdraw == []


def test_mass_miss_in_a_big_scope_is_treated_as_a_broken_source():
    rows = [known(i, f"Team{i}", 5 + i, missed=1) for i in range(1, 11)]  # 10 upcoming rows, each already missed once
    p = withdraw.plan(rows, [event(r) for r in rows[:4]], NOW)  # 6 of 10 missing > 50 %
    assert p.withdraw == [] and p.missed == [] and "missing at once" in p.warnings[0]


def test_cap_of_25_percent_per_run_in_a_big_scope():
    rows = [known(i, f"Team{i}", 5 + i, missed=1) for i in range(1, 11)]
    p = withdraw.plan(rows, [event(r) for r in rows[:6]], NOW)  # 4 due of 10 = 40 % > 25 %, not a mass miss
    assert p.withdraw == [] and "cap 25%" in p.warnings[0]
    p = withdraw.plan(rows, [event(r) for r in rows[:8]], NOW)  # 2 due of 10 = 20 %
    assert sorted(p.withdraw) == [9, 10] and p.warnings == []


def test_the_percent_guards_do_not_apply_below_eight_upcoming_rows():
    rows = [known(i, f"Team{i}", 5 + i, missed=1) for i in range(1, 8)]  # 7 rows
    p = withdraw.plan(rows, [event(rows[0])], NOW)  # 6 of 7 missing: only the karens decides
    assert sorted(p.withdraw) == [2, 3, 4, 5, 6, 7] and p.warnings == []


def test_past_started_final_postponed_and_already_withdrawn_rows_are_never_touched():
    keep = known(1, "Alpha")
    rows = [keep, known(2, "Past", -3, missed=1), known(3, "Done", 10, missed=1, status="final"), known(4, "Gone", 10, missed=1, withdrawn=True),
            known(5, "Postponed", 10, missed=1, status="postponed")]
    assert withdraw.plan(rows, [event(keep)], NOW) == withdraw.Plan()


class Db:
    """In-memory sport_events for what runner.run_source touches: the SELECT, the upsert, the two UPDATEs and the health row."""

    def __init__(self, rows):
        self.rows, self.health, self.calls, self._result = rows, [], [], []

    def execute(self, sql, params=()):
        self.calls.append(sql)
        if sql.lstrip().startswith("SELECT"):
            self._result = [dict(r) for r in self.rows]
        elif sql.startswith("UPDATE sport_events SET withdrawn_at"):
            for r in self.rows:
                if r["id"] in params[0]:
                    r["withdrawn_at"], r["missed_runs"] = NOW, r["missed_runs"] + 1
        elif sql.startswith("UPDATE sport_events SET missed_runs"):
            for r in self.rows:
                if r["id"] in params[0]:
                    r["missed_runs"] += 1
        elif "INSERT INTO sport_events" in sql:
            for r in self.rows:
                if r["source_uid"] == params[2]:
                    r["withdrawn_at"], r["missed_runs"] = None, 0
        elif "sport_sources_health" in sql:
            self.health.append(params)

    def fetchall(self):
        return self._result


def row(k: Known):
    return dict(id=k.id, source_uid=k.source_uid, program_id=k.program_id, sport=k.sport, gender=k.gender, start_at=k.start_at, status=k.status,
                withdrawn_at=None, missed_runs=k.missed_runs, home_program_id=k.home_program_id, home_name=k.home_name,
                away_program_id=k.away_program_id, away_name=k.away_name)


def test_runner_two_runs_withdraw_then_a_returning_game_is_cleared(monkeypatch):
    soon = datetime.now(timezone.utc) + timedelta(days=30)
    a, b = known(1, "Alpha", start=soon), known(2, "Beta", start=soon + timedelta(days=7))
    db = Db([row(a), row(b)])
    monkeypatch.setitem(adapters._ADAPTERS, "fake_wd", lambda params: params["_events"])

    def go(events):
        return runner.run_source(db, "t", {"adapter": "fake_wd", "program": P, "params": {"_events": events}}, http=object())

    assert go([event(a)]) == "ok" and db.rows[1]["missed_runs"] == 1 and db.rows[1]["withdrawn_at"] is None
    assert go([event(a)]) == "ok" and db.rows[1]["withdrawn_at"] is not None
    assert go([event(a), event(b)]) == "ok" and db.rows[1]["withdrawn_at"] is None and db.rows[1]["missed_runs"] == 0
    assert db.health[-1][4] is None  # a clean run leaves the warning slot empty


def test_a_run_that_returns_nothing_records_the_warning_and_changes_no_row(monkeypatch):
    soon = datetime.now(timezone.utc) + timedelta(days=30)
    a, b = known(1, "Alpha", start=soon, missed=1), known(2, "Beta", start=soon + timedelta(days=7), missed=1)
    db = Db([row(a), row(b)])
    monkeypatch.setitem(adapters._ADAPTERS, "fake_empty", lambda params: [])
    assert runner.run_source(db, "t", {"adapter": "fake_empty", "program": P}, http=object()) == "ok"
    assert not any(s.startswith("UPDATE sport_events") for s in db.calls)
    assert db.health[-1][4].startswith("warning: ") and "returned no games" in db.health[-1][4]


def test_a_skipped_run_changes_no_row(monkeypatch):
    a, b = known(1, "Alpha"), known(2, "Beta", 20, missed=1)
    db = Db([row(a), row(b)])

    def refuse(params):
        raise SourceSkipped("403")

    monkeypatch.setitem(adapters._ADAPTERS, "fake_boom", refuse)
    assert runner.run_source(db, "t", {"adapter": "fake_boom", "program": P}, http=object()) == "skipped"
    assert not any(s.startswith("UPDATE sport_events") for s in db.calls) and db.rows[1]["missed_runs"] == 1


def test_the_upsert_clears_withdrawal_and_migration_070_is_additive():
    cur = Db([])
    store.upsert_events(cur, "t", [event(known(1, "Alpha"))])
    assert "withdrawn_at=NULL" in cur.calls[0] and "missed_runs=0" in cur.calls[0]
    sql = (Path(__file__).parent.parent / "db" / "migrations" / "070_sport_events_withdrawn.sql").read_text(encoding="utf-8")
    assert apply_migration.check_additive(sql) == [] and len(apply_migration.statements(sql)) == 2
