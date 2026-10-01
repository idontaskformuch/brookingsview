"""One-time backfill for stories.title rows whose baked-in meeting date is
wrong -- found 2026-10-01 during final push verification, same root cause
as the Broomfield/Moreno Valley meeting_date fixes: ai_pipeline/publish.py's
build_title() (and ai_pipeline/meeting_followups.py's own title label) read
the meeting date's raw UTC calendar components with no timezone conversion,
correct for Legistar towns (bare calendar date) but wrong for eSCRIBE/
AgendaLink towns (a real, tz-aware instant). A Broomfield story's title
read "City Council Regular Meeting — Wed, Oct 14, 2026" for a meeting
actually on Tuesday evening Denver time.

KNOWN, DELIBERATE, NARROWER SCOPE than the underlying bug: the meeting's
published URL SLUG (e.g. "meeting-2026-07-08-11357") is built from the same
wrong raw-UTC date (ai_pipeline/publish.py's slug_date()) and is off by the
same one day -- but the slug is already published/potentially indexed, and
safely renaming it needs the same redirect-generation machinery this repo
already built for the Phase B1 duplicate-slug incident
(scripts/resolve_duplicate_meeting_slugs.py + site/server/
legacy-meeting-redirects.json). That is a separate, larger, higher-risk
task, deliberately NOT attempted here -- this script only corrects the
TITLE TEXT in place (same slug, same URL, no redirect needed).

Recomputes each row's title from the SAME build_title()/meeting_followups.py
label logic the pipeline itself now uses (now fixed), using the meeting's
real occurs_at and the town's own config -- no re-scraping needed. Backs
up every affected row before writing, same convention as this repo's other
backfill scripts.

Usage:
    python -m scripts.backfill_meeting_title_dates --dry-run
    python -m scripts.backfill_meeting_title_dates
"""
from __future__ import annotations

import argparse
import json
from calendar import month_name
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ai_pipeline.publish import _meeting_date_title_part
from db.db import get_conn

TOWNS = ("brookings_sd", "moreno_valley_ca", "broomfield_co")
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def _followup_label(occurs_at: datetime, cfg: dict) -> str:
    dt = occurs_at
    if cfg.get("data_sources", {}).get("city_meetings", {}).get("meetings_have_time", False):
        dt = dt.astimezone(ZoneInfo(cfg["timezone"]))
    return f"{month_name[dt.month]} {dt.day}, {dt.year}"


def find_changed_rows(conn) -> list[dict]:
    changed = []
    with conn.cursor() as cur:
        for town_id in TOWNS:
            cfg = json.loads(Path(f"configs/{town_id}.json").read_text(encoding="utf-8"))
            cur.execute(
                """
                SELECT id, slug, source_type, title, occurs_at
                  FROM stories
                 WHERE town_id = %s AND source_type IN ('meeting', 'meeting_followup')
                   AND occurs_at IS NOT NULL
                 ORDER BY occurs_at
                """,
                (town_id,),
            )
            for id_, slug, source_type, title, occurs_at in cur.fetchall():
                if source_type == "meeting":
                    body = title.split(" — ")[0] if " — " in title else title
                    when = _meeting_date_title_part(occurs_at, cfg)
                    new_title = f"{body} — {when}" if when else body
                else:  # meeting_followup
                    prefix = title.split(", ")[0] if ", " in title else title
                    label = _followup_label(occurs_at, cfg)
                    new_title = f"{prefix}, {label}"
                if new_title != title:
                    changed.append({
                        "id": id_, "town_id": town_id, "slug": slug,
                        "old_title": title, "new_title": new_title,
                    })
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sample", type=int, default=10)
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
        backup_path = BACKUP_DIR / f"meeting_title_date_backfill_{stamp}.json"
        backup_path.write_text(json.dumps(changed, indent=2), encoding="utf-8")
        print(f"\nBacked up {len(changed)} row(s) to {backup_path}")

        with conn.cursor() as cur:
            for row in changed:
                cur.execute("UPDATE stories SET title = %s WHERE id = %s", (row["new_title"], row["id"]))
        print(f"Updated title on {len(changed)} row(s).")


if __name__ == "__main__":
    main()
