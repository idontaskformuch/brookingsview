"""One-time backfill for stories.title rows that are actually a Legistar
"Notice of Quorum" posting (SDCL 1-25-1.1) mislabeled as a real meeting --
found 2026-10-01: Brookings' homepage "Next meeting" hero showed "City
Council, Thu, October 1" for what was really a solar farm ribbon-cutting
ceremony, where enough council members might attend to technically
constitute a quorum but "no official city business will be acted upon."
24 of Brookings' published meeting stories turned out to be this.

Recomputes each affected row's title using the now-fixed build_title()
(ai_pipeline/publish.py), which now checks is_quorum_notice_only() and
produces "Notice: possible quorum — {event}" instead of "{body} — {date}".
Only meetings rows are in scope (meeting_followup is a different,
unaffected title scheme). Backs up every affected row before writing.

Usage:
    python -m scripts.backfill_quorum_notice_titles --dry-run
    python -m scripts.backfill_quorum_notice_titles
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ai_pipeline.publish import extract_quorum_event, is_quorum_notice_only
from db.db import get_conn

TOWNS = ("brookings_sd", "moreno_valley_ca", "broomfield_co")
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def find_changed_rows(conn) -> list[dict]:
    """Deliberately narrower than "recompute build_title() and diff": that
    would ALSO silently re-decide two separate, previously-deliberate
    forward-only fixes this script was never asked to touch -- the raw-ISO-
    timestamp title bug (fixed forward-only, see fmt_dt()'s history) and
    the AdSense remediation Phase B2 town-name-prefix removal (also
    explicitly forward-only -- "already-published titles... keep their
    prefix"). Only rows that are ACTUALLY a quorum-notice-only posting are
    in scope here."""
    changed = []
    with conn.cursor() as cur:
        for town_id in TOWNS:
            cur.execute(
                """
                SELECT s.id, s.slug, s.title, m.raw_data
                  FROM stories s
                  JOIN meetings m ON m.id = s.meeting_id
                 WHERE s.town_id = %s AND s.source_type = 'meeting'
                """,
                (town_id,),
            )
            for sid, slug, title, raw_data in cur.fetchall():
                if isinstance(raw_data, str):
                    raw_data = json.loads(raw_data)
                raw_data = raw_data or {}
                if not is_quorum_notice_only(raw_data):
                    continue
                event = extract_quorum_event(raw_data.get("agenda_text") or "")
                if not event:
                    continue  # can't build a real label -- leave untouched, don't guess
                new_title = f"Notice: possible quorum — {event}"
                if new_title != title:
                    changed.append({
                        "id": sid, "town_id": town_id, "slug": slug,
                        "old_title": title, "new_title": new_title,
                    })
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sample", type=int, default=30)
    args = parser.parse_args()

    with get_conn() as conn:
        changed = find_changed_rows(conn)
        if not changed:
            print("No story titles need correcting -- nothing to do.")
            return

        by_town: dict[str, list[dict]] = {}
        for row in changed:
            by_town.setdefault(row["town_id"], []).append(row)

        for town_id, rows in by_town.items():
            print(f"\n=== {town_id}: {len(rows)} title(s) would change ===")
            for row in rows[: args.sample]:
                print(f"  {row['slug']}")
                print(f"    before: {row['old_title']!r}")
                print(f"    after:  {row['new_title']!r}")
            if len(rows) > args.sample:
                print(f"  ... and {len(rows) - args.sample} more")

        print(f"\nTotal: {len(changed)} row(s) across {len(by_town)} town(s).")

        if args.dry_run:
            print("\n--dry-run: no changes written, no backup file created.")
            return

        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = BACKUP_DIR / f"quorum_notice_title_backfill_{stamp}.json"
        backup_path.write_text(json.dumps(changed, indent=2, default=str), encoding="utf-8")
        print(f"\nBacked up {len(changed)} row(s) to {backup_path}")

        with conn.cursor() as cur:
            for row in changed:
                cur.execute("UPDATE stories SET title = %s WHERE id = %s", (row["new_title"], row["id"]))
        print(f"Updated title on {len(changed)} row(s).")


if __name__ == "__main__":
    main()
