"""Regenerates site/server/duplicate-story-redirects.json straight from the
DB's own superseded_by_slug column on stories (source_type='meeting'),
across all towns.

Replaces the former hand-maintained, single-entry version of this file
(2026-10-14, the 12940/13790 eSCRIBE content_hash-drift merge) -- that
approach didn't scale once more duplicate meeting pairs were found and
marked (see .claude/state.md, the 10 Moreno Valley pairs from the 2026-10-14
mass-reinsert). The DB column is the actual source of truth for which rows
are superseded; this script just mirrors it into the JSON file worker.ts
statically imports, so a fresh run after any new superseded_by_slug UPDATE
keeps the file in sync without hand-editing.

Scoped to source_type='meeting' only -- source_type='event' duplicates are
already covered by scripts/merge_recurring_event_duplicates.py's own
event-series-redirects.json, sourced from the same column; including events
here too would just duplicate those entries in a second file.

Usage:
    python -m scripts.generate_duplicate_story_redirects
"""
from __future__ import annotations

import json
from pathlib import Path

from db.db import get_conn

REDIRECT_MAP_PATH = Path(__file__).resolve().parent.parent / "site" / "server" / "duplicate-story-redirects.json"


def build_redirect_map(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT slug, superseded_by_slug
              FROM stories
             WHERE source_type = 'meeting' AND superseded_by_slug IS NOT NULL
             ORDER BY slug
            """
        )
        rows = cur.fetchall()
    return {slug: canonical for slug, canonical in rows}


def main() -> int:
    with get_conn() as conn:
        redirect_map = build_redirect_map(conn)

    REDIRECT_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    REDIRECT_MAP_PATH.write_text(json.dumps(redirect_map, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(redirect_map)} entries to {REDIRECT_MAP_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
