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
