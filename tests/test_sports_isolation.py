"""One failing page does not stop the others: its scope counts as NOT READ (no missed_runs, no withdrawal); all pages failing is still an error."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from sports import adapters, runner, withdraw
from sports.http import PoliteHttp, SourceSkipped
from sports.withdraw import Known

FX = Path(__file__).parent / "fixtures" / "sports"
ROBOTS = (Path(__file__).parent / "fixtures" / "robots" / "gojacks.txt").read_text(encoding="utf-8")
SOURCE = next(s for s in json.loads((Path(__file__).parent.parent / "configs" / "brookings_sd.json").read_text(encoding="utf-8"))["sports"]["sources"]
              if s["program"] == "sdsu")
SLUGS = list(SOURCE["params"]["sports"])
BROKEN = "mens-basketball"  # the page that failed in the 17:02 run on 2026-11-08


class Net:
    """gojacks.com served from the recorded pages; `fail` maps a slug to the statuses its page answers with (the last repeats)."""

    def __init__(self, fail=None, refuse=None):
        self.fail, self.refuse, self.now, self.sleeps, self.hits = dict(fail or {}), refuse, 0.0, [], {}

    def get(self, url, ua):
        if url.endswith("/robots.txt"):
            return 200, ROBOTS
        slug = url.split("/sports/")[1].split("/")[0]
        self.hits[slug] = self.hits.get(slug, 0) + 1
        if slug == self.refuse:
            return 403, ""
        if slug in self.fail:
            seq = self.fail[slug]
            return seq[min(self.hits[slug] - 1, len(seq) - 1)], ""
        return 200, (FX / f"gojacks_{slug}.html").read_text(encoding="utf-8")

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def http(self):
        return PoliteHttp("UA-test", get=self.get, sleep=self.sleep, clock=lambda: self.now)


def fetch(net):
    params = adapters.merged_params(SOURCE)
    params["_http"] = net.http()
    return adapters.get("internal")(params)


def test_a_page_that_fails_twice_is_skipped_and_the_other_sports_are_still_read():
    net = Net(fail={BROKEN: [None]})
    rows = fetch(net)
    assert net.hits[BROKEN] == 2  # the single retry, no third try
    assert {(e.sport, e.gender) for e in rows} == {("football", "men"), ("basketball", "women"), ("volleyball", "women")}
    assert len(rows) == 12 + 32 + 29
    assert [(u["sport"], u["gender"], u["slug"]) for u in rows.unread] == [("basketball", "men", BROKEN)]
    assert "answered None" in rows.unread[0]["reason"]


def test_a_page_that_fails_once_and_then_answers_is_read_in_full():
    class Recovering(Net):
        def get(self, url, ua):
            if f"/sports/{BROKEN}/" in url and self.hits.get(BROKEN, 0) == 0:
                self.hits[BROKEN] = 1
                return None, ""
            return super().get(url, ua)

    rows = fetch(Recovering())
    assert rows.unread == [] and len(rows) == 104


def test_all_pages_failing_is_an_error_as_before():
    net = Net(fail={slug: [None] for slug in SLUGS})
    with pytest.raises(RuntimeError, match="answered None"):
        fetch(net)


def test_a_refusal_on_one_page_still_skips_the_whole_source():
    with pytest.raises(SourceSkipped):
        fetch(Net(refuse=BROKEN))


# --- the withdraw plan: an unread scope is left exactly as it was --------------------------------------------------------------

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)


def known(i, sport, gender, opp, missed):
    return Known(id=i, source_uid=f"u{i}", program_id="sdsu", sport=sport, gender=gender, start_at=NOW + timedelta(days=5 + i), status="scheduled",
                 withdrawn=False, missed_runs=missed, home_program_id="sdsu", home_name=None, away_program_id=None, away_name=opp)


def test_an_unread_scope_gets_no_missed_runs_and_no_withdrawal_but_other_scopes_are_judged():
    rows = [known(1, "basketball", "men", "A", 1), known(2, "basketball", "men", "B", 0),   # unread scope: both missing from this run
            known(3, "football", "men", "C", 1), known(4, "football", "men", "D", 0)]        # read scope: both missing
    # football is a READ scope: one football game comes back, the two old ones are missing
    from sports.models import NormalizedEvent
    kept = NormalizedEvent(source="internal", source_uid="new-football", sport="football", level="college", gender="men", program_id="sdsu",
                           tz="America/Chicago", start_at=NOW + timedelta(days=30), home_program_id="sdsu", away_name="Z")
    plan = withdraw.plan(rows, [kept], NOW, unread={("sdsu", "basketball", "men")})
    assert 1 not in plan.withdraw + plan.missed and 2 not in plan.withdraw + plan.missed
    assert plan.withdraw == [3] and plan.missed == [4] and plan.warnings == []  # football is judged as usual
    without = withdraw.plan(rows, [kept], NOW)
    assert 1 not in without.withdraw and any("returned no games" in w for w in without.warnings)  # unmarked, the no-games guard holds it back but warns; marked, the scope is simply not judged


class Db:
    def __init__(self, rows):
        self.rows, self.health, self.calls, self._result = rows, [], [], []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
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
        elif "sport_sources_health" in sql:
            self.health.append(params)

    def fetchall(self):
        return self._result


def test_runner_partial_run_is_ok_with_a_warning_and_leaves_the_unread_sports_rows_alone():
    future = datetime.now(timezone.utc) + timedelta(days=60)
    # two upcoming men's basketball rows from an earlier run, one of them already missed once; neither is in this run because the page failed
    db_rows = [dict(id=i, source_uid=f"old{i}", program_id="sdsu", sport="basketball", gender="men", start_at=future + timedelta(days=i), status="scheduled",
                    withdrawn_at=None, missed_runs=m, home_program_id="sdsu", home_name=None, away_program_id=None, away_name=f"Opp{i}")
               for i, m in ((1, 1), (2, 0))]
    db = Db(db_rows)
    assert runner.run_source(db, "brookings_sd", SOURCE, http=Net(fail={BROKEN: [None]}).http()) == "ok"
    assert [(r["id"], r["missed_runs"], r["withdrawn_at"]) for r in db.rows] == [(1, 1, None), (2, 0, None)]
    assert not any(sql.startswith("UPDATE sport_events") for sql, _ in db.calls)
    assert sum("INSERT INTO sport_events" in sql for sql, _ in db.calls) == 73
    town, sid, _, count, warning, warned_at = db.health[-1]
    assert (sid, count) == ("internal:sdsu", 73) and warned_at is not None
    assert warning.startswith("warning: ") and BROKEN in warning and "left as they were" in warning
    # the same two rows on a run where the page IS read and still lists neither: now they count (first run of the karens: row 1 is withdrawn)
    db2 = Db([dict(r) for r in db_rows])
    assert runner.run_source(db2, "brookings_sd", SOURCE, http=Net().http()) == "ok"
    assert [(r["id"], r["missed_runs"], r["withdrawn_at"] is not None) for r in db2.rows] == [(1, 2, True), (2, 1, False)]


def test_runner_every_page_failing_is_an_error_and_changes_no_row():
    db = Db([])
    assert runner.run_source(db, "brookings_sd", SOURCE, http=Net(fail={s: [None] for s in SLUGS}).http()) == "error"
    assert "RuntimeError" in db.health[-1][2] and not any("INSERT INTO sport_events" in sql for sql, _ in db.calls)
