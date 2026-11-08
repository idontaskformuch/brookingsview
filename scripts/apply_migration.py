"""Apply one ADDITIVE migration file (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS only) through the prod write guard.

    python -m scripts.prod_backup apply_migration "SELECT 'new tables only, no existing rows touched' AS note"
    ALLOW_PROD_WRITE=apply_migration python -m scripts.apply_migration 066_local_sports --prod

Without --prod and ALLOW_PROD_WRITE the connection is read-only and the script stops at the first statement.
Anything that is not a plain CREATE ... IF NOT EXISTS (DROP, ALTER, UPDATE, DELETE, INSERT, TRUNCATE) is refused: those need their own approval and backup (CLAUDE.md rule 14).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from db.db import declare_action, get_conn

MIGRATIONS = Path(__file__).resolve().parent.parent / "db" / "migrations"
_FORBIDDEN = re.compile(r"\b(drop|alter|update|delete|insert|truncate|grant|revoke)\b", re.I)
_CREATE = re.compile(r"^create\s+(table|index)\s+if\s+not\s+exists\b", re.I)


def statements(sql: str) -> list[str]:
    no_comments = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def check_additive(sql: str) -> list[str]:
    problems = []
    for stmt in statements(sql):
        if not _CREATE.match(stmt):
            problems.append(f"not a CREATE ... IF NOT EXISTS: {stmt[:60]!r}")
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
