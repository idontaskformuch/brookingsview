"""ai_pipeline/api_usage.py -- API Cost Logging spec (2026-10-01).

Two properties matter most here, both explicit "Done when" requirements:
  1. A logging failure (DB down, bad query, whatever) must NEVER propagate
     and stop a publish -- log_usage()/finalize_outcome() degrade to a
     stderr warning, always. Proven below with a conn that raises on every
     call.
  2. finalize_generation()'s guardrail_rejected/published split -- the last
     attempt in a sequence gets the terminal outcome, every earlier attempt
     (which was, by definition, retried because it got rejected) gets
     'guardrail_rejected'.

No real DB connection anywhere here (tests.yml: "ingen nätverks-/
DB-åtkomst") -- ai_pipeline.api_usage.get_conn is monkeypatched with a
small in-memory fake, same approach as tests/test_search_budget.py.
"""
from __future__ import annotations

from contextlib import contextmanager

import pytest

from ai_pipeline import api_usage


class _FakeCursor:
    def __init__(self, store: dict):
        self.store = store
        self._result = None

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("INSERT INTO api_usage"):
            new_id = len(self.store) + 1
            self.store[new_id] = {"outcome": params[-1]}
            self._result = (new_id,)
        elif norm.startswith("UPDATE api_usage SET outcome"):
            outcome, row_id = params
            self.store[row_id]["outcome"] = outcome
        else:
            raise AssertionError(f"unexpected SQL in fake cursor: {norm!r}")

    def fetchone(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, store: dict):
        self.store = store

    def cursor(self):
        return _FakeCursor(self.store)

    def commit(self):
        pass


@pytest.fixture
def fake_db(monkeypatch):
    store: dict = {}

    @contextmanager
    def _fake_get_conn():
        yield _FakeConn(store)

    monkeypatch.setattr(api_usage, "get_conn", _fake_get_conn)
    return store


@contextmanager
def _raising_get_conn():
    raise RuntimeError("simulated DB outage")
    yield  # pragma: no cover -- unreachable, keeps this a generator


def test_log_usage_db_failure_returns_none_and_never_raises(monkeypatch):
    monkeypatch.setattr(api_usage, "get_conn", _raising_get_conn)
    # Must not raise -- this is the core safety property the spec requires
    # ("Ett misslyckat logganrop får aldrig stoppa en publicering").
    result = api_usage.log_usage(provider="anthropic", model="claude-haiku-4-5-20251001",
                                 input_tokens=10, output_tokens=5, generator="weekly")
    assert result is None


def test_finalize_outcome_db_failure_never_raises(monkeypatch):
    monkeypatch.setattr(api_usage, "get_conn", _raising_get_conn)
    api_usage.finalize_outcome(123, "published")  # must not raise


def test_finalize_outcome_none_id_is_a_silent_noop(fake_db):
    api_usage.finalize_outcome(None, "published")
    assert fake_db == {}


def test_log_usage_success_returns_id_and_persists_row(fake_db):
    usage_id = api_usage.log_usage(provider="anthropic", model="claude-haiku-4-5-20251001",
                                   input_tokens=100, output_tokens=50, attempt=1,
                                   outcome="pending", generator="weekly", town_id="brookings_sd")
    assert usage_id == 1
    assert fake_db[1]["outcome"] == "pending"


def test_take_last_usage_id_round_trips_from_log_usage(fake_db):
    usage_id = api_usage.log_usage(provider="anthropic", generator="weekly")
    assert api_usage.take_last_usage_id() == usage_id
    # Popped -- a second read sees nothing, so a caller that forgets to read
    # it can't accidentally attribute a stale id to an unrelated call.
    assert api_usage.take_last_usage_id() is None


def test_log_usage_with_no_generator_set_falls_back_to_unknown(fake_db, capsys):
    usage_id = api_usage.log_usage(provider="brave")
    assert usage_id == 1
    captured = capsys.readouterr()
    assert "no generator set" in captured.err


def test_usage_context_sets_generator_town_run(fake_db):
    with api_usage.usage_context(generator="weekly", town_id="brookings_sd", run_id="run-1"):
        usage_id = api_usage.log_usage(provider="anthropic")
    # No explicit generator/town/run passed to log_usage() -- must have come
    # from the context.
    assert usage_id == 1


def test_nested_usage_context_overrides_only_generator(fake_db):
    """format_record()'s own real use: an outer usage_context() sets town_id/
    run_id for the whole publish.py run, and a narrower, nested one around
    one record's calls overrides only `generator` (varies per source_type)
    -- town_id/run_id must still be inherited from the outer context, not
    cleared to None."""
    with api_usage.usage_context(generator="publish_run_default", town_id="brookings_sd", run_id="run-7"):
        with api_usage.usage_context(generator="meeting"):
            assert api_usage._generator_var.get() == "meeting"
            assert api_usage._town_id_var.get() == "brookings_sd"
            assert api_usage._run_id_var.get() == "run-7"
        # Restored after the inner context exits.
        assert api_usage._generator_var.get() == "publish_run_default"


def test_finalize_generation_last_attempt_published_earlier_ones_rejected(fake_db):
    ids = [
        api_usage.log_usage(provider="anthropic", generator="weekly", attempt=1),
        api_usage.log_usage(provider="anthropic", generator="weekly", attempt=2),
    ]
    api_usage.finalize_generation(ids, succeeded=True)
    assert fake_db[ids[0]]["outcome"] == "guardrail_rejected"
    assert fake_db[ids[1]]["outcome"] == "published"


def test_finalize_generation_failure_uses_fallback_outcome(fake_db):
    ids = [api_usage.log_usage(provider="anthropic", generator="weekly", attempt=1)]
    api_usage.finalize_generation(ids, succeeded=False, fallback_outcome="template_fallback")
    assert fake_db[ids[0]]["outcome"] == "template_fallback"


def test_finalize_generation_content_track_has_no_template_fallback(fake_db):
    """content/_base.py's content track has no TEMPLATERS concept -- a final
    failure there is 'guardrail_rejected', never 'template_fallback'."""
    ids = [api_usage.log_usage(provider="anthropic", generator="editorial", attempt=1)]
    api_usage.finalize_generation(ids, succeeded=False, fallback_outcome="guardrail_rejected")
    assert fake_db[ids[0]]["outcome"] == "guardrail_rejected"


def test_finalize_generation_dry_run_overrides_published(fake_db):
    """weekly.py's --dry-run: a real, successful AI call that never gets
    written to stories must log 'dry_run', not 'published' (otherwise
    cost_report.py's waste query can't tell a real publish from a test
    run)."""
    ids = [api_usage.log_usage(provider="anthropic", generator="weekly", attempt=1)]
    api_usage.finalize_generation(ids, succeeded=True, success_outcome="dry_run")
    assert fake_db[ids[0]]["outcome"] == "dry_run"


def test_finalize_generation_empty_usage_ids_is_a_noop(fake_db):
    api_usage.finalize_generation([], succeeded=True)
    assert fake_db == {}
