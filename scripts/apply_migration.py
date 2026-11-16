"""Apply one ADDITIVE migration file (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, or a
DROP + ADD CONSTRAINT pair that only widens a CHECK IN list, only) through the prod write guard, in one transaction.
If it refuses a statement: stop and ask the owner. Never run the migration another way around the check (CLAUDE.md rule 16).

    python -m scripts.prod_backup apply_migration "SELECT 'new tables only, no existing rows touched' AS note"
    ALLOW_PROD_WRITE=apply_migration python -m scripts.apply_migration 066_local_sports --prod

Without --prod and ALLOW_PROD_WRITE the connection is read-only and the script stops at the first statement.
Anything else (DROP, ALTER, UPDATE, DELETE, INSERT, TRUNCATE) is refused: those need their own approval and backup (CLAUDE.md rule 14).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from db.db import declare_action, get_conn

MIGRATIONS = Path(__file__).resolve().parent.parent / "db" / "migrations"
_FORBIDDEN = re.compile(r"\b(drop|alter|update|delete|insert|truncate|grant|revoke)\b", re.I)
_CREATE = re.compile(r"^create\s+(table|index)\s+if\s+not\s+exists\b", re.I)
# The one ALTER that is allowed: adding a column that is not there yet (nothing existing is changed or removed). Extended
# 2026-11-13 (owner, proposal 5, after 071 had to go round this check): any of these types, optionally an array; a bare
# REFERENCES <table> (<col>) with no ON DELETE/ON UPDATE action (the new column is all NULL, nothing to validate); NOT NULL only
# together with a DEFAULT (without one it fails on any table that has rows). CHECK stays refused: it validates existing rows.
_TYPE = r"(boolean|smallint|integer|int|bigint|numeric(\(\d+(,\s*\d+)?\))?|text|date|timestamptz|jsonb)(\[\])?"
_DEFAULT = r"\s+default\s+(true|false|-?\d+(\.\d+)?|'[^']*'(::\w+(\[\])?)?|now\(\))"
_ADD_COLUMN = re.compile(
    r"^alter\s+table\s+\w+\s+add\s+column\s+if\s+not\s+exists\s+\w+\s+" + _TYPE +
    r"(\s+references\s+\w+\s*\(\s*\w+\s*\))?"
    r"(\s+not\s+null" + _DEFAULT + r"|" + _DEFAULT + r"\s+not\s+null|" + _DEFAULT + r")?$", re.I)
# Widening a CHECK list (owner 2026-11-16, 072 semi-pro): DROP CONSTRAINT c directly followed by ADD CONSTRAINT c on the same
# table, a pure "<col> IN ('a', ...)" on the same column, holding every value the live constraint holds. Existing rows all
# pass the wider list. Both statements run in apply's one transaction, so the table is never without the check.
_DROP_CHECK = re.compile(r"^alter\s+table\s+(\w+)\s+drop\s+constraint\s+(\w+)$", re.I)
_ADD_CHECK = re.compile(r"^alter\s+table\s+(\w+)\s+add\s+constraint\s+(\w+)\s+check\s*\(\s*(\w+)\s+in\s*\(([^()]*)\)\s*\)$", re.I)
_IN_VALUES = re.compile(r"^\s*'[^']*'(\s*,\s*'[^']*')*\s*$")
# pg_get_constraintdef's form of the same list: CHECK ((level = ANY (ARRAY['pro'::text, 'minor'::text])))
_LIVE_CHECK = re.compile(r"^CHECK \(\((\w+) = ANY \(ARRAY\[((?:'[^']*'::text(?:, )?)+)\]\)\)\)$")


def parse_live_check(definition: str) -> tuple[str, tuple[str, ...]] | None:
    m = _LIVE_CHECK.match(definition)
    return (m.group(1), tuple(re.findall(r"'([^']*)'", m.group(2)))) if m else None


def _widening_problem(drop: str, add: str | None, live: dict[str, tuple[str, str]]) -> str | None:
    d = _DROP_CHECK.match(drop)
    a = _ADD_CHECK.match(add) if add else None
    if not a:
        return f"DROP CONSTRAINT not directly followed by ADD CONSTRAINT ... CHECK (<col> IN (...)): {drop[:60]!r}"
    table, name = d.group(1).lower(), d.group(2).lower()
    if (a.group(1).lower(), a.group(2).lower()) != (table, name):
        return f"ADD CONSTRAINT must re-add {table}.{name}: {add[:60]!r}"
    if not _IN_VALUES.match(a.group(4)):
        return f"CHECK is not a plain list of quoted values: {add[:60]!r}"
    if name not in live or live[name][0].lower() != table:
        return f"no live CHECK constraint {table}.{name}"
    parsed = parse_live_check(live[name][1])
    if not parsed:
        return f"live {name} is not a plain IN list: {live[name][1][:60]!r}"
    if a.group(3).lower() != parsed[0].lower():
        return f"{name} checks {parsed[0]}, not {a.group(3)}"
    new = re.findall(r"'([^']*)'", a.group(4))
    removed = [v for v in parsed[1] if v not in new]
    if removed:
        return f"{name} would drop allowed values {removed}"
    if len(set(new)) != len(new):
        return f"{name} lists a value twice"
    return None


def statements(sql: str) -> list[str]:
    no_comments = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def check_additive(sql: str, live_checks: dict[str, tuple[str, str]] | None = None) -> list[str]:
    """live_checks: constraint name -> (table, pg_get_constraintdef) for the CHECKs a widening pair may replace."""
    problems = []
    stmts = statements(sql)
    i = 0
    while i < len(stmts):
        stmt = stmts[i]
        i += 1
        if _DROP_CHECK.match(stmt):
            add = stmts[i] if i < len(stmts) else None
            problem = _widening_problem(stmt, add, live_checks or {})
            if problem:
                problems.append(problem)
            else:
                i += 1
            continue
        if _ADD_COLUMN.match(stmt):
            continue
        if not _CREATE.match(stmt):
            problems.append(f"not a CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS: {stmt[:60]!r}")
        elif _FORBIDDEN.search(re.sub(r"'[^']*'", "''", stmt)):
            problems.append(f"forbidden keyword in: {stmt[:60]!r}")
    return problems


def main(argv: list[str]) -> int:
    declare_action("apply_migration")
    names = [a for a in argv if not a.startswith("-")]
    if len(names) != 1:
        print(__doc__)
        return 2
    path = MIGRATIONS / f"{names[0]}.sql"
    if not path.is_file():
        print(f"no such migration: {path}")
        return 2
    sql = path.read_text(encoding="utf-8")
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT conname, conrelid::regclass::text, pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c'")
        live = {name: (table, definition) for name, table, definition in cur.fetchall()}
        problems = check_additive(sql, live)
        if problems:
            print("\n".join(problems))
            return 1
        for stmt in statements(sql):
            cur.execute(stmt)
    print(f"applied {path.name}: {len(statements(sql))} statements")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
