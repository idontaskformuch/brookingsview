"""One-time cleanup for the duplicate meeting slugs found live 2026-08-29
(AdSense remediation Phase B1) -- see db/migrations/034_stories_meeting_id.sql
for the root-cause explanation. For every meeting with two stories rows
(one legacy slug "meeting-{id}", one dated "meeting-{date}-{id}"), this
keeps the DATED row (the decided canonical scheme) and deletes the legacy
row. Safe: confirmed no foreign key anywhere references stories.id or
stories.slug (grepped db/schema.sql and every db/migrations/*.sql) --
project_updates.meeting_id references meetings(id) directly, untouched by
which stories row represents that meeting.

Writes a redirect map (legacy slug -> canonical slug) to
site/server/legacy-meeting-redirects.json for site/server/worker.ts to
serve as real 301s, so the already-published legacy URLs don't just 404.
Co-located with worker.ts rather than site/src/lib/ -- site/server/ is a
separate build context (its own tsconfig.json) from the Astro app, and
this file exists purely for the Worker to import.

Usage:
    python -m scripts.resolve_duplicate_meeting_slugs --dry-run
    python -m scripts.resolve_duplicate_meeting_slugs
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from db.db import get_conn

DATED_RE = re.compile(r"^meeting-\d{4}-\d{2}-\d{2}-\d+$")
LEGACY_RE = re.compile(r"^meeting-\d+$")

REDIRECT_MAP_PATH = Path(__file__).resolve().parent.parent / "site" / "server" / "legacy-meeting-redirects.json"


def find_duplicate_pairs(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT town_id, meeting_id, array_agg(slug ORDER BY slug) AS slugs, array_agg(id ORDER BY slug) AS ids
              FROM stories
             WHERE source_type = 'meeting' AND meeting_id IS NOT NULL
             GROUP BY town_id, meeting_id
            HAVING count(*) > 1
             ORDER BY town_id, meeting_id
            """
        )
        rows = cur.fetchall()

    pairs = []
    for town_id, meeting_id, slugs, ids in rows:
        dated = [s for s in slugs if DATED_RE.match(s)]
        legacy = [s for s in slugs if LEGACY_RE.match(s)]
        if len(dated) != 1 or len(legacy) != 1:
            print(f"  SKIPPING {town_id}/meeting {meeting_id}: unexpected slug shapes {slugs!r} "
                  "-- not the known dated+legacy pair pattern, needs manual review")
            continue
        legacy_id = ids[slugs.index(legacy[0])]
        pairs.append({
            "town_id": town_id, "meeting_id": meeting_id,
            "canonical_slug": dated[0], "legacy_slug": legacy[0], "legacy_story_id": legacy_id,
        })
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        pairs = find_duplicate_pairs(conn)
        print(f"{len(pairs)} duplicate pair(s) found")

        if args.dry_run:
            for p in pairs:
                print(f"  {p['town_id']}: DELETE {p['legacy_slug']!r} (id={p['legacy_story_id']}), "
                      f"keep {p['canonical_slug']!r}")
            print("\n(dry-run -- nothing deleted, redirect map not written)")
            return 0

        with conn.cursor() as cur:
            for p in pairs:
                cur.execute("DELETE FROM stories WHERE id = %s", (p["legacy_story_id"],))
        conn.commit()
        print(f"Deleted {len(pairs)} legacy-slug row(s).")

    redirect_map = {p["legacy_slug"]: p["canonical_slug"] for p in pairs}
    REDIRECT_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    REDIRECT_MAP_PATH.write_text(json.dumps(redirect_map, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote redirect map ({len(redirect_map)} entries) to {REDIRECT_MAP_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
