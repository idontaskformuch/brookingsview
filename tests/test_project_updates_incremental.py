"""Incremental processing for ai_pipeline/project_updates.py (owner decision
2026-10-14, see db/migrations/056_project_updates_checkpoints.sql): before
this, a scheduled rerun would call the real Anthropic API again for every
unmatched candidate-shaped agenda item, every run, forever. These tests
prove a SECOND run over the exact same data makes zero such calls --
"fake the storage, run the real logic" (same pattern as
tests/test_new_in_town_digest.py's _FakeBizConn), driving the real
main() end to end with psycopg.connect and ai_match_candidate patched out.
"""
import sys
import types

import pytest

from ai_pipeline import project_updates
from ai_pipeline.project_updates import (
    _agenda_items_hash, already_considered, get_checkpoint, main, set_checkpoint,
)


# --- _agenda_items_hash: deterministic, sensitive to real change ----------

def test_agenda_items_hash_stable_for_identical_content():
    a = [{"title": "Rezoning of 123 Main St", "details": "A rezoning request."}]
    b = [{"title": "Rezoning of 123 Main St", "details": "A rezoning request."}]
    assert _agenda_items_hash(a) == _agenda_items_hash(b)


def test_agenda_items_hash_changes_when_content_changes():
    a = [{"title": "Rezoning of 123 Main St", "details": "A rezoning request."}]
    b = [{"title": "Rezoning of 123 Main St", "details": "AMENDED rezoning request."}]
    assert _agenda_items_hash(a) != _agenda_items_hash(b)


# --- get_checkpoint/set_checkpoint/already_considered: fake-conn units ----

class _FakeCheckpointCursor:
    def __init__(self, store):
        self.store = store
        self._result = None

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("SELECT agenda_hash FROM project_updates_checkpoints"):
            (meeting_id,) = params
            h = self.store["checkpoints"].get(meeting_id)
            self._result = (h,) if h is not None else None
        elif norm.startswith("INSERT INTO project_updates_checkpoints"):
            meeting_id, agenda_hash = params
            self.store["checkpoints"][meeting_id] = agenda_hash
        elif norm.startswith("SELECT 1 FROM project_updates WHERE meeting_id"):
            meeting_id, counter = params
            self._result = (1,) if (meeting_id, counter) in self.store["project_updates"] else None
        elif norm.startswith("SELECT 1 FROM project_new_candidate_queue"):
            town_id, meeting_id, title = params
            self._result = (1,) if (town_id, meeting_id, title) in self.store["queue"] else None
        else:
            raise AssertionError(f"unexpected SQL: {norm!r}")

    def fetchone(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeCheckpointConn:
    def __init__(self):
        self.store = {"checkpoints": {}, "project_updates": set(), "queue": set()}

    def cursor(self, row_factory=None):
        return _FakeCheckpointCursor(self.store)


def test_checkpoint_round_trip_and_overwrite():
    conn = _FakeCheckpointConn()
    assert get_checkpoint(conn, 11344) is None
    set_checkpoint(conn, 11344, "hash-v1")
    assert get_checkpoint(conn, 11344) == "hash-v1"
    set_checkpoint(conn, 11344, "hash-v2")
    assert get_checkpoint(conn, 11344) == "hash-v2"


def test_already_considered_false_when_nothing_recorded():
    conn = _FakeCheckpointConn()
    assert already_considered(conn, "broomfield_co", 11344, "191", "Some title") is False


def test_already_considered_true_from_prior_project_update():
    conn = _FakeCheckpointConn()
    conn.store["project_updates"].add((11344, "191"))
    assert already_considered(conn, "broomfield_co", 11344, "191", "Some title") is True


def test_already_considered_true_from_prior_queue_row():
    conn = _FakeCheckpointConn()
    conn.store["queue"].add(("broomfield_co", 11344, "Some title"))
    assert already_considered(conn, "broomfield_co", 11344, "191", "Some title") is True


# --- end-to-end: main() itself makes 0 AI calls on a second identical run -

class _FakeMainCursor:
    def __init__(self, store, row_factory):
        self.store = store
        self.row_factory = row_factory
        self._result = []

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("SELECT id, slug, title, case_numbers FROM projects"):
            self._result = []  # no exact-match projects registered
        elif norm.startswith("SELECT id, body, meeting_date, agenda_url, raw_data"):
            self._result = list(self.store["meetings"].values())
        elif norm.startswith("SELECT agenda_hash FROM project_updates_checkpoints"):
            (meeting_id,) = params
            h = self.store["checkpoints"].get(meeting_id)
            self._result = (h,) if h is not None else None
        elif norm.startswith("INSERT INTO project_updates_checkpoints"):
            meeting_id, agenda_hash = params
            self.store["checkpoints"][meeting_id] = agenda_hash
            self._result = None
        elif norm.startswith("SELECT 1 FROM project_updates WHERE meeting_id"):
            meeting_id, counter = params
            self._result = (1,) if (meeting_id, counter) in self.store["project_updates"] else None
        elif norm.startswith("SELECT 1 FROM project_new_candidate_queue"):
            town_id, meeting_id, title = params
            self._result = (1,) if (town_id, meeting_id, title) in self.store["queue"] else None
        elif norm.startswith("SELECT id, title, description FROM projects"):
            self._result = []  # no open projects for AI matching against
        elif norm.startswith("INSERT INTO project_new_candidate_queue"):
            town_id, _source_type, meeting_id, _traffic_id, candidate_title = params[:5]
            self.store["queue"].add((town_id, meeting_id, candidate_title))
            self._result = None
        else:
            raise AssertionError(f"unexpected SQL: {norm!r}")

    def fetchone(self):
        return self._result if not isinstance(self._result, list) else None

    def fetchall(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeMainConn:
    def __init__(self, store):
        self.store = store

    def cursor(self, row_factory=None):
        return _FakeMainCursor(self.store, row_factory)

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


MEETING = {
    "id": 11344,
    "body": "City Council",
    "meeting_date": "2026-09-09",
    "agenda_url": "https://example.com/agenda",
    "raw_data": {
        "agenda_items": [
            {"title": "Rezoning of 123 Main Street", "details": "A rezoning request.",
             "item_number": "191"},
        ],
    },
}


@pytest.fixture
def fake_run(monkeypatch, tmp_path):
    store = {"meetings": {11344: dict(MEETING)}, "checkpoints": {}, "project_updates": set(), "queue": set()}
    conn = _FakeMainConn(store)

    monkeypatch.setattr(project_updates.psycopg, "connect", lambda *a, **kw: conn)
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake")

    ai_calls = []

    def fake_ai_match_candidate(candidate_text, open_projects, cfg):
        ai_calls.append(candidate_text)
        return {"match_project_id": None, "confidence": 0.0, "reasoning": "no open projects to match against"}

    monkeypatch.setattr(project_updates, "ai_match_candidate", fake_ai_match_candidate)

    config_path = tmp_path / "town.json"
    config_path.write_text('{"town_id": "broomfield_co"}', encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["project_updates", "--config", str(config_path)])

    return types.SimpleNamespace(store=store, ai_calls=ai_calls)


def test_first_run_makes_one_ai_call_and_queues_the_candidate(fake_run):
    main()
    assert len(fake_run.ai_calls) == 1
    assert ("broomfield_co", 11344, "Rezoning of 123 Main Street") in fake_run.store["queue"]


def test_second_run_on_the_same_data_makes_zero_ai_calls(fake_run):
    main()
    assert len(fake_run.ai_calls) == 1
    main()  # a later scheduled run, nothing changed
    assert len(fake_run.ai_calls) == 1, "second run must not re-call the AI for an already-decided item"


def test_second_run_skips_the_unchanged_meeting_entirely(fake_run):
    main()
    assert fake_run.store["checkpoints"].get(11344) is not None
    checkpoint_after_first_run = fake_run.store["checkpoints"][11344]
    main()
    assert fake_run.store["checkpoints"][11344] == checkpoint_after_first_run


def test_changed_meeting_is_reprocessed_but_already_queued_item_still_skips_ai(fake_run, monkeypatch):
    main()
    assert len(fake_run.ai_calls) == 1
    # Meeting changes (e.g. a new, unrelated item added) -- invalidates the
    # checkpoint, but the ORIGINAL item was already queued, so it alone
    # must not trigger a second AI call.
    fake_run.store["meetings"][11344]["raw_data"]["agenda_items"].append(
        {"title": "Approve meeting minutes", "details": "", "item_number": "192"}
    )
    main()
    assert len(fake_run.ai_calls) == 1, "the already-queued item must not be re-sent to the AI"
