"""Verifies the exact precedence semantics of the query in
ai_pipeline/project_updates_legistar.py::recompute_project_status() (and
the identical query in ai_pipeline/project_updates.py -- see migration
052_project_update_outcome_override.sql for why outcome_override exists:
a human-verified correction the automated pipeline must never silently
revert to 'pending').

This repo has no live-Postgres test fixture (no other test connects to a
real database -- pure-function unit tests only), so the query's SQL TEXT
is run here against sqlite instead of importing the production function
directly (psycopg's `%s` placeholders aren't sqlite3-compatible). The SQL
itself is copied verbatim except for the placeholder syntax -- this tests
the real logic, not a reimplementation of it.

Two distinct claims, each tested separately, because they are NOT the
same thing:
  1. Per-row: COALESCE(outcome_override, outcome) means an override on a
     given row always wins over THAT SAME row's own outcome -- this is
     the actual guarantee (protects a human correction from a pipeline
     rerun reverting it to 'pending').
  2. Project-wide: ORDER BY meeting_date DESC LIMIT 1 means the MOST
     RECENT qualifying row wins -- an override on an OLDER row does NOT
     beat a real (non-'pending') outcome on a NEWER row. Recency wins,
     not "override always wins project-wide."
"""
import sqlite3

QUERY = """
    SELECT COALESCE(outcome_override, outcome) FROM project_updates
     WHERE project_id = ? AND (outcome_override IS NOT NULL OR outcome <> 'pending')
     ORDER BY meeting_date DESC LIMIT 1
"""


def _conn_with_rows(rows: list[dict]):
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE project_updates (project_id INT, meeting_date TEXT, "
        "outcome TEXT, outcome_override TEXT)"
    )
    for r in rows:
        conn.execute(
            "INSERT INTO project_updates (project_id, meeting_date, outcome, outcome_override) "
            "VALUES (1, ?, ?, ?)",
            (r["meeting_date"], r["outcome"], r.get("outcome_override")),
        )
    conn.commit()
    return conn


def _resolved_outcome(conn) -> str:
    cur = conn.execute(QUERY, (1,))
    row = cur.fetchone()
    return row[0] if row else "pending"


def test_override_wins_over_its_own_rows_outcome():
    """The actual guarantee migration 052 exists for: a human-verified
    outcome_override is read instead of that SAME row's auto-computed
    outcome -- never silently reverted to 'pending' by a pipeline rerun."""
    conn = _conn_with_rows([
        {"meeting_date": "2026-06-01", "outcome": "pending", "outcome_override": "denied"},
    ])
    assert _resolved_outcome(conn) == "denied"


def test_real_pen24_0154_shape_override_on_older_row_survives_a_still_pending_newer_appeal():
    """The real, documented case (migration 052's own docstring, PEN24-0154):
    a June denial with a real outcome_override, followed by a September
    appeal that hasn't been decided yet (outcome='pending', no override).
    The pending appeal row doesn't qualify at all, so the June override
    is still the most recent QUALIFYING row -- status stays 'denied'."""
    conn = _conn_with_rows([
        {"meeting_date": "2026-06-15", "outcome": "pending", "outcome_override": "denied"},
        {"meeting_date": "2026-09-10", "outcome": "pending", "outcome_override": None},
    ])
    assert _resolved_outcome(conn) == "denied"


def test_a_newer_real_outcome_beats_an_older_overridden_row():
    """The claim 'outcome_override ALWAYS wins over any Legistar outcome'
    is too strong -- NOT what the code does. Recency wins at the project
    level: once the September row gets a real, non-pending Legistar
    outcome (e.g. the appeal is actually decided), that newer row wins
    over the older override, exactly like it would over any other older
    non-override row. The override's real guarantee is narrower (see
    test_override_wins_over_its_own_rows_outcome above): it protects ITS
    OWN row from being reverted to pending, not the whole project's
    status from ever changing again."""
    conn = _conn_with_rows([
        {"meeting_date": "2026-06-15", "outcome": "pending", "outcome_override": "denied"},
        {"meeting_date": "2026-09-10", "outcome": "approved", "outcome_override": None},
    ])
    assert _resolved_outcome(conn) == "approved"
