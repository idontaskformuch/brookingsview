"""ai_pipeline/publish.py's retry cap (NEEDS-HUMAN-REVIEW.md #77/#78): a
meeting/event/alert record that fails format_record() both attempts gets
discarded and retried every scheduled run, forever, with no counter --
found live via api_usage.reject_reason. MAX_CONSECUTIVE_DISCARDS caps that
at 3, after which the record is excluded for good and alerted on.

No real DB connection (tests.yml: "ingen nätverks-/DB-åtkomst") -- a small
in-memory fake cursor/conn, same approach as tests/test_search_budget.py
and tests/test_api_usage.py.
"""
from __future__ import annotations

from ai_pipeline.publish import (
    MAX_CONSECUTIVE_DISCARDS, clear_discard_streak, load_given_up_records, record_discard,
)


class _FakeCursor:
    def __init__(self, store: dict):
        self.store = store
        self._result = None

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("SELECT source_type, record_id FROM publish_discard_streak"):
            town_id, threshold = params
            self._rows = [
                (st, rid) for (t, st, rid), row in self.store.items()
                if t == town_id and row["consecutive_runs"] >= threshold
            ]
        elif norm.startswith("INSERT INTO publish_discard_streak"):
            town_id, source_type, record_id, reject_reason = params
            key = (town_id, source_type, record_id)
            if key in self.store:
                self.store[key]["consecutive_runs"] += 1
            else:
                self.store[key] = {"consecutive_runs": 1}
            self.store[key]["last_reject_reason"] = reject_reason
            self._result = (self.store[key]["consecutive_runs"],)
        elif norm.startswith("DELETE FROM publish_discard_streak"):
            town_id, source_type, record_id = params
            self.store.pop((town_id, source_type, record_id), None)
        else:
            raise AssertionError(f"unexpected SQL in fake cursor: {norm!r}")

    def fetchone(self):
        return self._result

    def fetchall(self):
        return self._rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, store: dict):
        self.store = store

    def cursor(self, **kwargs):
        return _FakeCursor(self.store)


def test_record_discard_starts_at_one():
    conn = _FakeConn({})
    streak = record_discard(conn, "brookings_sd", "meeting", "12989", "siffra saknas i källa: 42")
    assert streak == 1


def test_record_discard_increments_on_repeat():
    conn = _FakeConn({})
    record_discard(conn, "brookings_sd", "meeting", "12989", "reason A")
    streak = record_discard(conn, "brookings_sd", "meeting", "12989", "reason B")
    assert streak == 2


def test_record_discard_updates_last_reject_reason_each_time():
    store: dict = {}
    conn = _FakeConn(store)
    record_discard(conn, "brookings_sd", "meeting", "12989", "reason A")
    record_discard(conn, "brookings_sd", "meeting", "12989", "reason B")
    assert store[("brookings_sd", "meeting", "12989")]["last_reject_reason"] == "reason B"


def test_record_discard_tracks_different_records_independently():
    store: dict = {}
    conn = _FakeConn(store)
    record_discard(conn, "brookings_sd", "meeting", "1", "x")
    record_discard(conn, "brookings_sd", "meeting", "1", "x")
    record_discard(conn, "brookings_sd", "meeting", "2", "y")
    assert store[("brookings_sd", "meeting", "1")]["consecutive_runs"] == 2
    assert store[("brookings_sd", "meeting", "2")]["consecutive_runs"] == 1


def test_record_discard_tracks_series_string_ids():
    # Grouped recurring-event series use a synthetic "series-<hash>" id
    # (publish.py's group_recurring_events()), not a plain integer -- the
    # whole table/column is TEXT specifically for this.
    conn = _FakeConn({})
    streak = record_discard(conn, "moreno_valley_ca", "event", "series-06694b7aa5bee604", "möjlig åsikt/vinkling: must")
    assert streak == 1


def test_load_given_up_records_excludes_records_under_threshold():
    store: dict = {}
    conn = _FakeConn(store)
    record_discard(conn, "brookings_sd", "meeting", "1", "x")
    record_discard(conn, "brookings_sd", "meeting", "1", "x")
    assert load_given_up_records(conn, "brookings_sd") == set()


def test_load_given_up_records_includes_records_at_threshold():
    store: dict = {}
    conn = _FakeConn(store)
    for _ in range(MAX_CONSECUTIVE_DISCARDS):
        record_discard(conn, "brookings_sd", "meeting", "1", "x")
    assert load_given_up_records(conn, "brookings_sd") == {("meeting", "1")}


def test_load_given_up_records_scoped_to_town():
    store: dict = {}
    conn = _FakeConn(store)
    for _ in range(MAX_CONSECUTIVE_DISCARDS):
        record_discard(conn, "brookings_sd", "meeting", "1", "x")
    assert load_given_up_records(conn, "moreno_valley_ca") == set()


def test_clear_discard_streak_removes_the_row():
    store: dict = {}
    conn = _FakeConn(store)
    record_discard(conn, "brookings_sd", "meeting", "1", "x")
    clear_discard_streak(conn, "brookings_sd", "meeting", "1")
    assert ("brookings_sd", "meeting", "1") not in store


def test_clear_discard_streak_on_record_with_no_streak_is_a_noop():
    conn = _FakeConn({})
    clear_discard_streak(conn, "brookings_sd", "meeting", "999")  # must not raise
