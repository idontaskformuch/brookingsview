"""Shared pytest setup.

DATABASE GUARD (owner 2026-11-06, after 3723 mock api_usage rows reached the live Neon database): tests never get a database.
Layer 1: DATABASE_URL is replaced by an unreachable sentinel before any test module imports db.db (its load_dotenv() does not
         override an existing variable), and psycopg.connect raises in every test (a test that needs a fake connection patches
         its own module's name afterwards, which wins).
Layer 2: pytest_sessionstart refuses to run if a production-looking database URL is still visible anywhere in the environment.
Layer 3: tests/test_db_guard.py proves layers 1 and 2. A manual, read-only live check lives in scripts/, outside this guard.
"""
import os
import re
from pathlib import Path

import pytest

SENTINEL_DATABASE_URL = "postgresql://tests-never-connect:x@database.invalid/none"
_PROD_MARKERS = ("neon.tech",)


def _prod_hosts_from_dotenv() -> list[str]:
    """Hosts of any DATABASE_URL in the repo's .env, read WITHOUT putting it in the environment (never hard-coded here)."""
    env_file = Path(__file__).parent.parent / ".env"
    if not env_file.is_file():
        return []
    hosts = []
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"\s*(?:export\s+)?[A-Z_]*DATABASE_URL\s*=\s*['\"]?postgres(?:ql)?://[^@]*@([^/:?'\"\s]+)", line)
        if m:
            hosts.append(m.group(1))
    return hosts


def looks_like_production(value: str) -> bool:
    return any(marker in value for marker in _PROD_MARKERS) or any(h in value for h in _prod_hosts_from_dotenv())


os.environ["DATABASE_URL"] = SENTINEL_DATABASE_URL  # layer 1, at conftest import: before db.db's load_dotenv() can fill it from .env


def pytest_sessionstart(session):  # layer 2
    offenders = sorted(k for k, v in os.environ.items() if k != "DATABASE_URL" and v and looks_like_production(v))
    if os.environ.get("DATABASE_URL") != SENTINEL_DATABASE_URL:
        offenders.append("DATABASE_URL")
    if offenders:
        pytest.exit("Refusing to run: a production database URL is visible to the tests in " + ", ".join(offenders)
                    + ". Unset it for this shell (tests never get a database; see tests/conftest.py).", returncode=3)


@pytest.fixture(autouse=True)
def _no_database_connections(monkeypatch):
    """Layer 1, per test: psycopg.connect raises. A test with its own fake connection patches its module's name after this."""
    try:
        import psycopg
    except Exception:  # noqa: BLE001 -- nothing to guard when psycopg is not installed
        return

    def _refuse(*args, **kwargs):
        raise RuntimeError("tests must not open a database connection (tests/conftest.py)")

    monkeypatch.setattr(psycopg, "connect", _refuse)


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
