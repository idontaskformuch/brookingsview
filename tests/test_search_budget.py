"""ai_pipeline/search_budget.py -- proving the hard ceiling actually stops
requests (Handoff §6: "assert the ceiling actually stops requests, since
this exact class of bug shipped before" -- see db.py:last_run_at's
docstring for the refresh_minutes incident this directly guards against).

This is the one module in the pipeline whose correctness genuinely depends
on real read-then-write DB semantics (the row lock, the atomic check-and-
increment) -- a pure-function test can't exercise that. Rather than require
a live database in CI (this suite's own stated rule, see tests.yml: "ingen
nätverks-/DB-åtkomst"), this uses a small, self-contained in-memory fake
that implements just the handful of SQL calls reserve_request()/
requests_this_month() actually issue. The real Python logic in
search_budget.py runs unmodified against it -- only the storage is faked.
"""
from datetime import date

from ai_pipeline.search_budget import GLOBAL_MONTHLY_REQUEST_CEILING, reserve_request, requests_this_month


class _FakeCursor:
    def __init__(self, store: dict):
        self.store = store
        self._result = None

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("INSERT INTO search_request_log"):
            town_id, provider, period = params
            self.store.setdefault((town_id, provider, period), 0)
        elif "COALESCE(sum(request_count)" in norm:
            provider, period = params
            self._result = (sum(v for (_, p, per), v in self.store.items() if p == provider and per == period),)
        elif norm.startswith("SELECT request_count FROM search_request_log"):
            town_id, provider, period = params
            self._result = (self.store.get((town_id, provider, period), 0),)
        elif norm.startswith("UPDATE search_request_log"):
            town_id, provider, period = params
            self.store[(town_id, provider, period)] = self.store.get((town_id, provider, period), 0) + 1
        else:
            raise AssertionError(f"unexpected SQL in fake cursor: {norm!r}")

    def fetchone(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    """One shared `store` across every cursor -- mirrors a real connection
    where multiple cursor() calls all see the same committed rows."""
    def __init__(self):
        self.store: dict = {}

    def cursor(self):
        return _FakeCursor(self.store)

    def commit(self):
        pass


TODAY = date(2026, 8, 28)


def test_allows_requests_under_the_per_town_ceiling():
    conn = _FakeConn()
    for _ in range(5):
        assert reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY) is True
    assert requests_this_month(conn, "brookings_sd", today=TODAY) == 5


def test_blocks_the_instant_the_per_town_ceiling_is_reached():
    conn = _FakeConn()
    for _ in range(8):
        assert reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY) is True
    # The 9th call must be refused, not merely logged past.
    assert reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY) is False
    assert requests_this_month(conn, "brookings_sd", today=TODAY) == 8


def test_a_blocked_reservation_does_not_increment_the_counter():
    conn = _FakeConn()
    for _ in range(8):
        reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY)
    before = requests_this_month(conn, "brookings_sd", today=TODAY)
    reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY)
    reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY)
    after = requests_this_month(conn, "brookings_sd", today=TODAY)
    assert after == before, "a refused reservation must never still count against the budget"


def test_global_ceiling_blocks_even_a_town_still_under_its_own_limit():
    """Two towns, each with room left in their OWN per-town ceiling, but the
    fleet-wide total is already at the global cap -- the second town must
    still be refused. Proves the global check isn't a no-op alongside the
    per-town one."""
    conn = _FakeConn()
    for _ in range(GLOBAL_MONTHLY_REQUEST_CEILING):
        assert reserve_request(conn, "brookings_sd", per_town_ceiling=1000, today=TODAY) is True

    # A different town, well under ITS OWN per-town ceiling, hits the shared
    # global wall instead.
    assert reserve_request(conn, "moreno_valley_ca", per_town_ceiling=1000, today=TODAY) is False


def test_ceiling_resets_for_a_new_month():
    conn = _FakeConn()
    for _ in range(8):
        reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY)
    assert reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=TODAY) is False

    next_month = date(2026, 9, 15)
    assert reserve_request(conn, "brookings_sd", per_town_ceiling=8, today=next_month) is True


def test_requests_this_month_is_zero_before_any_reservation():
    conn = _FakeConn()
    assert requests_this_month(conn, "brookings_sd", today=TODAY) == 0
