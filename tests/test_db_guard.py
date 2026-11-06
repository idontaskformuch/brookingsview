"""The database guard in tests/conftest.py (owner 2026-11-06): tests never get a database."""
import os

import pytest

from tests import conftest as guard


def test_database_url_is_the_unreachable_sentinel():
    assert os.environ["DATABASE_URL"] == guard.SENTINEL_DATABASE_URL
    assert not guard.looks_like_production(os.environ["DATABASE_URL"])


def test_importing_db_does_not_pull_the_real_url_in_from_dotenv():
    import db.db  # noqa: F401 -- its load_dotenv() runs at import
    assert os.environ["DATABASE_URL"] == guard.SENTINEL_DATABASE_URL


def test_psycopg_connect_raises_in_a_plain_test():
    import psycopg
    with pytest.raises(RuntimeError, match="must not open a database connection"):
        psycopg.connect(os.environ["DATABASE_URL"])


def test_get_conn_cannot_reach_a_database():
    from db.db import get_conn
    with pytest.raises(Exception):
        with get_conn():
            pass


def test_production_looking_urls_are_recognised():
    assert guard.looks_like_production("postgresql://u:p@ep-x-y-123.c-3.us-east-2.aws.neon.tech/neondb")
    assert not guard.looks_like_production("postgresql://u:p@localhost/test")


def test_session_start_refuses_when_a_production_url_is_visible(monkeypatch):
    monkeypatch.setenv("SOME_OTHER_VAR", "postgresql://u:p@ep-a-b-1.aws.neon.tech/db")
    with pytest.raises(pytest.exit.Exception):
        guard.pytest_sessionstart(None)
    monkeypatch.delenv("SOME_OTHER_VAR")
    guard.pytest_sessionstart(None)  # clean environment: no exit


def test_session_start_refuses_when_database_url_is_not_the_sentinel(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    with pytest.raises(pytest.exit.Exception):
        guard.pytest_sessionstart(None)
