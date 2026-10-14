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
from datetime import datetime, timedelta, timezone

import pytest

from ai_pipeline import project_updates
from ai_pipeline.project_updates import (
    MIN_HOURS_BETWEEN_RUNS, _agenda_items_hash, already_considered, get_checkpoint, get_last_success,
    has_project_signal, main, matching_routine_pattern, queue_auto_rejected, record_run, set_checkpoint,
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
        elif norm.startswith("SELECT last_success_at FROM project_updates_runs"):
            (town_id,) = params
            row = self.store["runs"].get(town_id)
            self._result = (row[0],) if row else None
        elif norm.startswith("INSERT INTO project_updates_runs"):
            town_id, when, ai_calls, meetings_processed, meetings_skipped, cap_hit = params
            self.store["runs"][town_id] = (when, ai_calls, meetings_processed, meetings_skipped, cap_hit)
        elif norm.startswith("INSERT INTO project_new_candidate_queue") and "auto_rejected" in norm:
            town_id, meeting_id, candidate_title, _summary, _reason = params
            self.store["queue"].add((town_id, meeting_id, candidate_title))
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
        self.store = {"checkpoints": {}, "project_updates": set(), "queue": set(), "runs": {}}

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


# --- record_run/get_last_success: the per-run stats are DB-readable -------
# See db/migrations/057_project_updates_runs_counters.sql -- confirming a
# scheduled run's behavior shouldn't require reading the GitHub Actions
# log.

def test_record_run_round_trip_of_all_counters():
    conn = _FakeCheckpointConn()
    assert get_last_success(conn, "broomfield_co") is None
    when = datetime(2026, 10, 14, 18, 0, 0, tzinfo=timezone.utc)
    record_run(conn, "broomfield_co", when, ai_calls=3, meetings_processed=5,
              meetings_skipped=20, cap_hit=False)
    assert get_last_success(conn, "broomfield_co") == when
    assert conn.store["runs"]["broomfield_co"] == (when, 3, 5, 20, False)


def test_record_run_overwrites_the_previous_run_for_the_same_town():
    conn = _FakeCheckpointConn()
    record_run(conn, "broomfield_co", datetime(2026, 10, 14, 18, 0, tzinfo=timezone.utc), ai_calls=3)
    record_run(conn, "broomfield_co", datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc), ai_calls=0,
              meetings_skipped=5)
    _when, ai_calls, _processed, meetings_skipped, _cap = conn.store["runs"]["broomfield_co"]
    assert ai_calls == 0
    assert meetings_skipped == 5


# --- routine-administrative filter: real Moreno Valley candidates --------
# See module docstring's "Routine-administrative filter" section. Titles
# below are the real, live queue rows (#40-46) this filter was built and
# tuned against.

CFD_ANNEXATION_TITLE = (
    "ANNEXATION OF CERTAIN PARCELS INTO CFD NO. 2014-01 (MAINTENANCE SERVICES) "
    "AND CFD NO. 2023-01 (PUBLIC SAFETY SERVICES)"
)
REIMBURSEMENT_TITLE = (
    "ADOPT A RESOLUTION AUTHORIZING REIMBURSEMENT OF CERTAIN CAPITAL IMPROVEMENT "
    "EXPENDITURES FROM THE PROCEEDS OF A FUTURE INDEBTEDNESS"
)
CIP_AMENDMENT_TITLE = (
    "AMEND THE ADOPTED CAPITAL IMPROVEMENT PLAN BY ADDING SEGMENTS OF ARTERIAL STREETS "
    "FOR FUTURE IMPROVEMENTS"
)
DRAIN_BASIN_TITLE = (
    "COOPERATIVE AGREEMENT FOR THE MORENO MASTER DRAIN PLAN LINE F DETENTION BASIN "
    "PROJECT WITHIN THE WORLD LOGISTICS CENTER SPECIFIC PLAN"
)


def test_cfd_annexation_matches_routine_pattern():
    assert matching_routine_pattern(CFD_ANNEXATION_TITLE) == "cfd_annexation"


def test_reimbursement_resolution_matches_routine_pattern():
    assert matching_routine_pattern(REIMBURSEMENT_TITLE) == "reimbursement_resolution"


def test_cip_amendment_matches_routine_pattern():
    assert matching_routine_pattern(CIP_AMENDMENT_TITLE) == "capital_improvement_plan"


def test_drain_basin_item_matches_no_routine_pattern():
    # The one real candidate (#42) that IS a genuine site-specific
    # project -- must not match any routine-administrative pattern.
    assert matching_routine_pattern(DRAIN_BASIN_TITLE) is None


def test_unrelated_title_matches_no_routine_pattern():
    assert matching_routine_pattern("Rezoning of 123 Main Street") is None


def test_has_project_signal_true_for_extractable_case_number():
    assert has_project_signal("Some item (PEN25-0098)") is True


def test_has_project_signal_true_for_each_entitlement_phrase():
    for phrase in ["Tract Map", "Specific Plan", "Conditional Use Permit",
                   "Plot Plan", "Change of Zone", "Development Agreement"]:
        assert has_project_signal(f"Approving a {phrase} for the project") is True


def test_has_project_signal_false_for_plain_routine_item():
    assert has_project_signal(CFD_ANNEXATION_TITLE) is False


def test_tract_map_that_also_forms_a_cfd_is_not_filtered():
    # The exact owner-specified case: a real entitlement (Tract Map) that
    # ALSO mentions forming a Community Facilities District to fund its
    # own infrastructure -- matching_routine_pattern() alone WOULD flag
    # this (it mentions "Community Facilities District"), but
    # has_project_signal() must override that and keep it headed to the
    # AI, never auto-rejected.
    title = ("Approve Vesting Tentative Tract Map No. 39999 and form a Community "
             "Facilities District to fund related infrastructure")
    assert matching_routine_pattern(title) == "community_facilities_district"
    assert has_project_signal(title) is True


# --- queue_auto_rejected: traceable, not just logged ----------------------

def test_queue_auto_rejected_writes_status_and_reason():
    conn = _FakeCheckpointConn()
    queue_auto_rejected(conn, "moreno_valley_ca", meeting_id=13782,
                        candidate_title=CFD_ANNEXATION_TITLE, candidate_summary="summary text",
                        pattern_name="cfd_annexation")
    assert ("moreno_valley_ca", 13782, CFD_ANNEXATION_TITLE) in conn.store["queue"]


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
        elif norm.startswith("INSERT INTO project_new_candidate_queue") and "auto_rejected" in norm:
            town_id, meeting_id, candidate_title, _summary, _reason = params
            self.store["queue"].add((town_id, meeting_id, candidate_title))
            self.store["auto_rejected"].append((town_id, meeting_id, candidate_title))
            self._result = None
        elif norm.startswith("INSERT INTO project_new_candidate_queue"):
            town_id, _source_type, meeting_id, _traffic_id, candidate_title = params[:5]
            self.store["queue"].add((town_id, meeting_id, candidate_title))
            self._result = None
        elif norm.startswith("SELECT last_success_at FROM project_updates_runs"):
            (town_id,) = params
            v = self.store["last_success"].get(town_id)
            self._result = (v,) if v is not None else None
        elif norm.startswith("INSERT INTO project_updates_runs"):
            town_id, when, ai_calls, meetings_processed, meetings_skipped, cap_hit = params
            self.store["last_success"][town_id] = when
            self.store["run_stats"][town_id] = {
                "ai_calls": ai_calls, "meetings_processed": meetings_processed,
                "meetings_skipped": meetings_skipped, "cap_hit": cap_hit,
            }
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


def _backdate_last_success(store, town_id, hours_ago):
    """Simulates real elapsed time passing between two scheduled runs --
    cheaper and more precise than monkeypatching datetime.now()."""
    store["last_success"][town_id] = datetime.now(timezone.utc) - timedelta(hours=hours_ago)


@pytest.fixture
def fake_run(monkeypatch, tmp_path):
    store = {"meetings": {11344: dict(MEETING)}, "checkpoints": {}, "project_updates": set(),
             "queue": set(), "last_success": {}, "run_stats": {}, "auto_rejected": []}
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
    stats = fake_run.store["run_stats"]["broomfield_co"]
    assert stats == {"ai_calls": 1, "meetings_processed": 1, "meetings_skipped": 0, "cap_hit": False}


# --- run-level gate: real elapsed time, not an hour-of-day check ----------

def test_immediate_second_run_is_a_full_noop_via_the_run_gate(fake_run):
    # A scheduled workflow firing again a few hours later (same day) must
    # not even scan meetings -- the run-level gate short-circuits main()
    # before any of the per-meeting/per-item logic runs at all.
    main()
    assert len(fake_run.ai_calls) == 1
    main()
    assert len(fake_run.ai_calls) == 1, "a run inside MIN_HOURS_BETWEEN_RUNS must do nothing at all"


def test_run_proceeds_again_once_min_hours_have_elapsed(fake_run):
    main()
    assert len(fake_run.ai_calls) == 1
    _backdate_last_success(fake_run.store, "broomfield_co", hours_ago=MIN_HOURS_BETWEEN_RUNS + 1)
    main()
    # The run itself proceeds (not blocked by the gate)... but the ORIGINAL
    # item is already queued from the first run, so already_considered()
    # still stops a second AI call for it -- the run-level gate and the
    # per-item dedup are two independent, both-necessary layers.
    assert len(fake_run.ai_calls) == 1, "already_considered must still hold even once the run gate reopens"


def test_second_run_skips_the_unchanged_meeting_entirely(fake_run):
    main()
    assert fake_run.store["checkpoints"].get(11344) is not None
    checkpoint_after_first_run = fake_run.store["checkpoints"][11344]
    _backdate_last_success(fake_run.store, "broomfield_co", hours_ago=MIN_HOURS_BETWEEN_RUNS + 1)
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
    _backdate_last_success(fake_run.store, "broomfield_co", hours_ago=MIN_HOURS_BETWEEN_RUNS + 1)
    main()
    assert len(fake_run.ai_calls) == 1, "the already-queued item must not be re-sent to the AI"


# --- end-to-end: routine-administrative filter inside main() itself ------

def test_routine_item_is_auto_rejected_without_any_ai_call(fake_run):
    fake_run.store["meetings"][11344]["raw_data"]["agenda_items"] = [
        {"title": CFD_ANNEXATION_TITLE, "details": "", "item_number": "43"},
    ]
    main()
    assert len(fake_run.ai_calls) == 0
    assert ("broomfield_co", 11344, CFD_ANNEXATION_TITLE) in fake_run.store["queue"]
    assert fake_run.store["auto_rejected"] == [("broomfield_co", 11344, CFD_ANNEXATION_TITLE)]


def test_routine_item_with_a_project_signal_still_reaches_the_ai(fake_run):
    # Also mentions "subdivision" so is_candidate_agenda_item's own,
    # separate keyword gate lets it through in the first place -- the
    # project-signal exception only matters once past that gate.
    title = ("Approve Vesting Tentative Tract Map No. 39999, a subdivision, and form a "
             "Community Facilities District to fund related infrastructure")
    fake_run.store["meetings"][11344]["raw_data"]["agenda_items"] = [
        {"title": title, "details": "", "item_number": "44"},
    ]
    main()
    assert len(fake_run.ai_calls) == 1
    assert fake_run.store["auto_rejected"] == []
