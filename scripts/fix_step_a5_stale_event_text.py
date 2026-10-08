"""Events correctness Step A, point 5 (2026-10-08): two surgical, one-time
text corrections to live `stories` rows, approved by the owner after a
dry-run review (see .claude/state.md) rather than regenerated via AI or
replaced with the bare-title template fallback -- both rows are otherwise
accurate and useful, so a full-sentence/word fix keeps more real content
than either alternative the master handoff named.

1. event-304376 ("Corpse Bride Outdoor Screening", moreno_valley_ca): the
   source `events` row has no description field at all (confirmed:
   raw_data->>'description' is NULL) -- "All ages welcome." in the
   published body has no source support whatsoever, a fabrication the
   Phase 1 point 3 regeneration script (scripts/regenerate_stale_event_
   bodies.py) already tried to fix and gave up on (both AI attempts
   rejected for unrelated reasons). Drops only that sentence.

2. event-series-ff09495d6ba56aca ("Moreno Valley: Libraries Close Early at
   5PM", moreno_valley_ca): body says hours "return on Saturday, November
   29" -- 2026-11-29 is actually a SUNDAY (2026-11-25 "Wednesday" is
   already correct). Out of scope for the point-3 regeneration script
   (is_recurring_series rows need a full merge rebuild, not a single
   events row) -- flagged there as a manual follow-up, this is it.

Each fix is hardcoded (exact old text -> exact new text, matched and
verified before writing), not a general find-and-replace -- this is a
one-time correction for two specific rows, not a reusable tool.

Usage:
    python -m scripts.fix_step_a5_stale_event_text --dry-run
    python -m scripts.fix_step_a5_stale_event_text
"""
from __future__ import annotations

import argparse

from db.db import get_conn

FIXES = [
    {
        "slug": "event-304376",
        "town_id": "moreno_valley_ca",
        "old_body": "An outdoor screening of Corpse Bride plays at Farm House Collective. All ages welcome.",
        "new_body": "An outdoor screening of Corpse Bride plays at Farm House Collective.",
    },
    {
        "slug": "event-series-ff09495d6ba56aca",
        "town_id": "moreno_valley_ca",
        "old_body": (
            "Moreno Valley Public Library locations will close at 5:00 pm on Wednesday, "
            "November 25, in observance of Thanksgiving. Regular hours return on Saturday, "
            "November 29. You can check your library account and download digital materials "
            "online at any time through www.moval.org/mv-library."
        ),
        "new_body": (
            "Moreno Valley Public Library locations will close at 5:00 pm on Wednesday, "
            "November 25, in observance of Thanksgiving. Regular hours return on Sunday, "
            "November 29. You can check your library account and download digital materials "
            "online at any time through www.moval.org/mv-library."
        ),
    },
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        with conn.cursor() as cur:
            for fix in FIXES:
                cur.execute(
                    "SELECT body FROM stories WHERE town_id = %s AND slug = %s",
                    (fix["town_id"], fix["slug"]),
                )
                row = cur.fetchone()
                if row is None:
                    print(f"  SKIP {fix['slug']}: no matching row found")
                    continue
                current_body = row[0]
                if current_body != fix["old_body"]:
                    print(f"  SKIP {fix['slug']}: live body no longer matches the expected old "
                          f"text (changed since this script was written) -- not touching it")
                    continue
                print(f"  {'WOULD FIX' if args.dry_run else 'FIX'} {fix['slug']}")
                print(f"    old: {fix['old_body']!r}")
                print(f"    new: {fix['new_body']!r}")
                if not args.dry_run:
                    cur.execute(
                        "UPDATE stories SET body = %s WHERE town_id = %s AND slug = %s",
                        (fix["new_body"], fix["town_id"], fix["slug"]),
                    )
        if args.dry_run:
            print("\n(dry-run -- nothing written)")
        else:
            conn.commit()
            print("\nCommitted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
