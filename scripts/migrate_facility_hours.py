"""One-time backfill: facilities.hours_text -> hours_structured/hours_needs_review
(db/migrations/038_facility_hours_structured.sql), via
ai_pipeline/facility_hours.py's deterministic parser.

Additive and safe to re-run: only ever touches hours_structured/
hours_needs_review, never hours_text itself, and always recomputes from the
CURRENT hours_text (so re-running after a human edits an ambiguous row's
hours_text is exactly how that row gets un-flagged, no special "clear the
flag" step needed).

Usage:
    python -m scripts.migrate_facility_hours            # dry run (default), prints a report
    python -m scripts.migrate_facility_hours --apply    # writes to DB
"""
from __future__ import annotations

import argparse
import json

from db.db import get_conn
from ai_pipeline.facility_hours import parse_hours_text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to the DB (default: dry run, report only)")
    args = ap.parse_args()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, town_id, slug, hours_text FROM facilities WHERE hours_text IS NOT NULL ORDER BY town_id, slug")
            rows = cur.fetchall()

            parsed_count = flagged_count = 0
            for facility_id, town_id, slug, hours_text in rows:
                result = parse_hours_text(hours_text)
                if result.structured is not None:
                    parsed_count += 1
                    print(f"  [parsed]  {town_id}/{slug}: {hours_text!r}")
                else:
                    flagged_count += 1
                    print(f"  [FLAGGED] {town_id}/{slug}: {result.reason}")

                if args.apply:
                    cur.execute(
                        "UPDATE facilities SET hours_structured = %s, hours_needs_review = %s WHERE id = %s",
                        (json.dumps(result.structured) if result.structured else None, result.needs_review, facility_id),
                    )
        # get_conn()'s own context manager commits on a clean exit -- no
        # explicit conn.commit() needed here, same convention as
        # scripts/seed_facility_name_aliases.py.

    print(f"\n{parsed_count} parsed, {flagged_count} flagged for review, "
          f"{'written to DB' if args.apply else 'DRY RUN -- nothing written, pass --apply to write'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
