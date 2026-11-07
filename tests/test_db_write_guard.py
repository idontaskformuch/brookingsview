"""db/db.py write guard (owner 2026-11-06): reads always work; a local process may only WRITE with --prod AND ALLOW_PROD_WRITE=<action>,
a same-day backup file must exist, inserted ids are logged, and CI (GITHUB_ACTIONS=true) is exempt. No real database anywhere."""
import json
from datetime import date

import pytest

import db.db as dbmod
from scripts import prod_backup


class FakeCursor:
    def __init__(self, conn):
        self.conn, self.rows, self.pos = conn, [], 0
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None, **kw):
        self.executed.append(query)
        if "information_schema" in query:
            self.rows = [("stories",), ("events",)]
        elif "RETURNING id" in query:
            self.rows = [(101,), (102,)]
        else:
            self.rows = []
        self.pos = 0

    def executemany(self, query, params_seq, **kw):
        self.executed.append(query)

    def fetchall(self):
        out = self.rows[self.pos:]
        self.pos = len(self.rows)
        return out

    def scroll(self, value, mode="relative"):
        self.pos = value


class FakeConn:
    def __init__(self):
        self.read_only = False
        self.closed = False
        self.cursors = []

    def cursor(self, *a, **kw):
        c = FakeCursor(self)
        self.cursors.append(c)
        return c

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        self.closed = True


@pytest.fixture
def guard(monkeypatch, tmp_path):
    conn = FakeConn()
    monkeypatch.setattr(dbmod.psycopg, "connect", lambda url, **kw: conn)
    monkeypatch.setattr(dbmod, "BACKUP_DIR", tmp_path)
    monkeypatch.setattr(dbmod, "_PROD_FLAG", False)
    monkeypatch.setattr(dbmod, "_DECLARED_ACTION", "fix_things")
    monkeypatch.setattr(dbmod, "_ANNOUNCED", set())
    monkeypatch.setattr(dbmod, "_INSERTED", [])
    monkeypatch.setattr(dbmod, "_ID_TABLES", None)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    monkeypatch.delenv("ALLOW_PROD_WRITE", raising=False)
    monkeypatch.setattr(dbmod.atexit, "register", lambda *a, **k: None)
    guard.conn = conn
    guard.dir = tmp_path
    return guard


def test_a_local_connection_without_flags_is_read_only(guard):
    assert dbmod.write_mode() == "read_only"
    with dbmod.get_conn():
        assert guard.conn.read_only is True


def test_one_flag_is_not_enough(guard, monkeypatch):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    assert dbmod.write_mode() == "read_only"
    monkeypatch.setattr(dbmod, "_PROD_FLAG", False)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "fix_things")
    assert dbmod.write_mode() == "read_only"


def test_both_flags_without_a_backup_refuses(guard, monkeypatch):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "fix_things")
    with pytest.raises(SystemExit, match="ingen backup"):
        dbmod.connect()


def test_both_flags_with_todays_backup_allow_writes_and_announce_host_and_action(guard, monkeypatch, capsys):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "fix_things")
    (guard.dir / f"{date.today().isoformat()}_fix_things.json").write_text("{}")
    conn = dbmod.connect()
    assert guard.conn.read_only is False
    err = capsys.readouterr().err
    assert "PROD-SKRIVNING TILLÅTEN" in err and "fix_things" in err and "värd=" in err
    conn.close()


def test_a_backup_from_another_day_does_not_count(guard, monkeypatch):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "fix_things")
    (guard.dir / "2020-01-01_fix_things.json").write_text("{}")
    with pytest.raises(SystemExit, match="ingen backup"):
        dbmod.connect()


def test_the_action_name_must_match_the_script(guard, monkeypatch):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "some_other_script")
    (guard.dir / f"{date.today().isoformat()}_some_other_script.json").write_text("{}")
    with pytest.raises(SystemExit, match="matchar inte"):
        dbmod.connect()


def test_github_actions_alone_locally_is_not_ci(guard, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert dbmod.write_mode() == "read_only"
    with dbmod.get_conn():
        assert guard.conn.read_only is True


def test_ci_is_exempt_even_without_flags(guard, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("GITHUB_RUN_ID", "123456789")
    assert dbmod.write_mode() == "ci"
    with dbmod.get_conn() as conn:
        assert conn is guard.conn and guard.conn.read_only is False


def test_prod_flag_is_removed_from_argv_so_argparse_never_sees_it():
    argv = ["script.py", "--config", "x.json", "--prod", "--apply"]
    assert dbmod._consume_prod_flag(argv) is True
    assert argv == ["script.py", "--config", "x.json", "--apply"]
    assert dbmod._consume_prod_flag(["script.py"]) is False


def _prod_conn(guard, monkeypatch):
    monkeypatch.setattr(dbmod, "_PROD_FLAG", True)
    monkeypatch.setenv("ALLOW_PROD_WRITE", "fix_things")
    (guard.dir / f"{date.today().isoformat()}_fix_things.json").write_text("{}")
    return dbmod.connect()


def test_insert_ids_are_logged_and_flushed_to_the_inserted_file(guard, monkeypatch):
    conn = _prod_conn(guard, monkeypatch)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO stories (title) VALUES (%s)", ("a",))
        assert cur.fetchall() == [(101,), (102,)]  # rewound: the caller can still read what was returned
    assert guard.conn.cursors[0].executed[-1].endswith("RETURNING id")
    conn.close()
    logged = json.loads((guard.dir / f"{date.today().isoformat()}_fix_things_inserted.json").read_text())
    assert logged == [{"table": "stories", "ids": [101, 102]}]


def test_insert_into_a_table_without_id_logs_the_statement_and_params(guard, monkeypatch):
    conn = _prod_conn(guard, monkeypatch)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO place_hours (k) VALUES (%s)", ("a",))
    assert not guard.conn.cursors[0].executed[-1].endswith("RETURNING id")
    assert dbmod._INSERTED[-1]["ids"] is None and dbmod._INSERTED[-1]["params"] == ("a",)
    conn.close()


def test_an_update_is_passed_through_untouched(guard, monkeypatch):
    conn = _prod_conn(guard, monkeypatch)
    with conn.cursor() as cur:
        cur.execute("UPDATE stories SET title = %s", ("a",))
    assert guard.conn.cursors[0].executed == ["UPDATE stories SET title = %s"]
    assert dbmod._INSERTED == []
    conn.close()


def test_prod_backup_refuses_anything_but_a_select(guard):
    with pytest.raises(SystemExit):
        prod_backup.backup("fix_things", "DELETE FROM stories")
    with pytest.raises(SystemExit):
        prod_backup.backup("../evil", "SELECT 1")
