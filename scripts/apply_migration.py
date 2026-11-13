"""Apply one ADDITIVE migration file (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS, or ALTER TABLE ... ADD COLUMN IF NOT EXISTS, only) through the prod write guard.
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


def statements(sql: str) -> list[str]:
    no_comments = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def check_additive(sql: str) -> list[str]:
    problems = []
    for stmt in statements(sql):
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
    problems = check_additive(sql)
    if problems:
        print("\n".join(problems))
        return 1
    with get_conn() as conn, conn.cursor() as cur:
        for stmt in statements(sql):
            cur.execute(stmt)
    print(f"applied {path.name}: {len(statements(sql))} statements")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
