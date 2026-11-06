"""Back up the rows an UPDATE/DELETE is about to touch, BEFORE running it with --prod (CLAUDE.md rule 14, db/db.py write guard).

    python -m scripts.prod_backup <action> "<SELECT that returns the rows that will be changed or deleted>"

<action> is the script's file name without .py (e.g. backfill_event_venues), or the name the script gives with db.declare_action().
Writes .claude/backups/<date>_<action>.json; db.get_conn() refuses a --prod write without that file from the same day.
Run the same command again with another SELECT to add more rows to the same file (the file keeps every select).

The SELECT runs on a read-only connection (this script never passes --prod), so it cannot change anything. Only SELECT/WITH is accepted.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from db.db import _database_url, backup_path, get_conn

_READ_ONLY_SQL = re.compile(r"^\s*(select|with)\b", re.I)


def backup(action: str, select_sql: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_]+", action):
        raise SystemExit(f"Ogiltigt åtgärdsnamn {action!r}: bara bokstäver, siffror och _.")
    if not _READ_ONLY_SQL.match(select_sql):
        raise SystemExit("Bara en SELECT (eller WITH ... SELECT) accepteras.")
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(select_sql)
        columns = [d.name for d in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]
    path = backup_path(action)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {
        "action": action, "host": urlparse(_database_url()).hostname, "selects": []}
    doc["selects"].append({"taken_at": datetime.now(timezone.utc).isoformat(), "select": select_sql, "row_count": len(rows), "rows": rows})
    path.write_text(json.dumps(doc, default=str, indent=1), encoding="utf-8")
    return {"path": str(path), "row_count": len(rows)}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    result = backup(argv[0], argv[1])
    print(f"Backup: {result['row_count']} rader -> {result['path']}")
    if result["row_count"] == 0:
        print("OBS: SELECT gav 0 rader (backupen finns men är tom).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
