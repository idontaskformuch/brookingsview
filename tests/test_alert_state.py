"""scrapers/alert_state.py: one alert when a problem appears, one reminder a day, one "resolved" -- never one per run (owner 2026-11-24).
Keys and messages are the real ones from the 2026-11-24 ntfy alarms (issues #13-#15)."""
from datetime import datetime, timedelta, timezone

from scrapers import alert_state as st

T0 = datetime(2026, 11, 24, 13, 46, tzinfo=timezone.utc)
K_QP = "freshness|ops.sport-freshness|glasgow|/glasgow/sportspress_calendar:queens-park"
K_QPW = "freshness|ops.sport-freshness|glasgow|/glasgow/sportspress_calendar:queens-park-women"
M_QP = "glasgow: sportspress_calendar:queens-park: last success 26.7 h ago (limit 26 h)."


class FakeConn:
    """alert_state as a dict; understands exactly the statements reconcile() issues."""
    def __init__(self, fail=False):
        self.rows, self.fail, self.commits = {}, fail, 0

    def execute(self, sql, params=()):
        if self.fail:
            raise RuntimeError('relation "alert_state" does not exist')
        if sql.startswith("SELECT"):
            scope = params[0]
            out = [(k, v["first"], v["last"], v["msg"]) for k, v in self.rows.items() if v["resolved"] is None and k.startswith(scope)]
            return type("R", (), {"fetchall": lambda s: out})()
        if sql.startswith("INSERT"):
            k, first, last, msg = params
            self.rows[k] = {"first": first, "last": last, "msg": msg, "n": 1, "resolved": None}
        elif sql.startswith("UPDATE alert_state SET last_notified_at"):
            now, msg, k = params
            self.rows[k].update(last=now, msg=msg, n=self.rows[k]["n"] + 1)
        elif sql.startswith("UPDATE alert_state SET resolved_at"):
            now, k = params
            self.rows[k]["resolved"] = now

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def run(conn, active, now, scope="freshness|ops.sport-freshness|"):
    sent = []
    res = st.reconcile(conn, scope, active, "[glasgow] ops.sport-freshness", now=now, send=lambda m, title=None, priority="default": sent.append((title, m)) or True)
    return res, sent


def test_new_problem_sends_once_then_stays_silent_on_the_next_runs():
    conn = FakeConn()
    res, sent = run(conn, {K_QP: M_QP}, T0)
    assert res["new"] == [K_QP] and len(sent) == 1 and "New problem" in sent[0][1] and M_QP in sent[0][1]
    for hours in (6, 12, 19):  # four more runs the same day: nothing
        res, sent = run(conn, {K_QP: M_QP}, T0 + timedelta(hours=hours))
        assert sent == [] and res == {"new": [], "reminder": [], "resolved": []}


def test_daily_reminder_while_the_problem_lasts():
    conn = FakeConn()
    run(conn, {K_QP: M_QP}, T0)
    res, sent = run(conn, {K_QP: M_QP}, T0 + timedelta(hours=24))
    assert res["reminder"] == [K_QP] and len(sent) == 1 and sent[0][0].endswith("still open") and "[day 2]" in sent[0][1]
    assert run(conn, {K_QP: M_QP}, T0 + timedelta(hours=30))[1] == []  # 6 h after the reminder: silent
    res, sent = run(conn, {K_QP: M_QP}, T0 + timedelta(hours=49))
    assert len(sent) == 1 and "[day 3]" in sent[0][1]


def test_resolved_message_once_when_the_problem_is_gone():
    conn = FakeConn()
    run(conn, {K_QP: M_QP}, T0)
    res, sent = run(conn, {}, T0 + timedelta(hours=8))
    assert res["resolved"] == [K_QP] and len(sent) == 1 and sent[0][0].endswith("resolved") and M_QP in sent[0][1]
    assert run(conn, {}, T0 + timedelta(hours=16))[1] == []  # nothing more once resolved


def test_two_problems_in_one_run_are_one_message_and_a_returning_problem_is_new_again():
    conn = FakeConn()
    res, sent = run(conn, {K_QP: M_QP, K_QPW: M_QP.replace("queens-park", "queens-park-women")}, T0)
    assert len(sent) == 1 and sent[0][1].count("last success") == 2
    run(conn, {}, T0 + timedelta(hours=8))
    res, sent = run(conn, {K_QP: M_QP}, T0 + timedelta(hours=20))
    assert res["new"] == [K_QP] and len(sent) == 1


def test_scope_keeps_one_checker_from_resolving_anothers_problems():
    conn = FakeConn()
    run(conn, {K_QP: M_QP}, T0)
    res, sent = run(conn, {}, T0 + timedelta(hours=1), scope="freshness|ops.evening-register-freshness|")
    assert res["resolved"] == [] and sent == []


def test_state_unavailable_returns_none_and_sends_nothing_so_the_caller_can_fall_back():
    res, sent = run(FakeConn(fail=True), {K_QP: M_QP}, T0)
    assert res is None and sent == []
