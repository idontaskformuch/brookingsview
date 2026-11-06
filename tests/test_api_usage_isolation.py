"""Regression (2026-11-06): pytest must not write api_usage rows to the live database (see tests/conftest.py)."""
from ai_pipeline import api_usage


def test_log_usage_in_a_test_never_reaches_a_database(capsys):
    with api_usage.usage_context(generator="editorial", town_id="brookings_sd"):
        assert api_usage.log_usage("anthropic", model="claude-haiku-4-5-20251001", input_tokens=10, output_tokens=20) is None
    assert "failed to log usage" in capsys.readouterr().err
