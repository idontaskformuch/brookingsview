"""Shared pytest setup."""
import pytest


@pytest.fixture(autouse=True)
def _uk_gate_log_goes_to_tmp(tmp_path, monkeypatch):
    """Tests that run publish_table() must not append their fixtures to the real reports/uk_gate_log.jsonl."""
    try:
        from ai_pipeline import publish
    except Exception:  # noqa: BLE001 -- a test module that cannot import publish has nothing to redirect
        return
    monkeypatch.setattr(publish, "UK_GATE_LOG", tmp_path / "uk_gate_log.jsonl")


@pytest.fixture(autouse=True)
def _api_usage_never_touches_the_live_database(monkeypatch):
    """log_usage() inserts into api_usage through db.db.get_conn(), which reads DATABASE_URL from .env. Every test that runs a
    generator with a mock client therefore wrote fake rows (mock tokens, run_id 'local-...') into the LIVE table: 23 rows per
    full pytest run, found 2026-11-06 as '464 editorial/media_recension calls on Brookings in 10 days'. A test that wants a fake
    connection (tests/test_api_usage.py, test_search_budget.py) monkeypatches get_conn itself, after this fixture."""
    try:
        from ai_pipeline import api_usage
    except Exception:  # noqa: BLE001 -- a test module that cannot import api_usage has nothing to guard
        return

    def _refuse():
        raise RuntimeError("tests must not open a database connection through api_usage.get_conn()")

    monkeypatch.setattr(api_usage, "get_conn", _refuse)
