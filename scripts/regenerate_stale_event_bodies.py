"""Events correctness Phase 1, point 3 (2026-10-08): one-time regeneration
for upcoming event stories whose body text was generated BEFORE the fmt_dt
fix (commit 28d1128) and whose occurs_at crosses a local/UTC calendar-day
boundary -- the exact condition under which that bug could have written a
wrong date/weekday into the published prose. Past events are already
noindex and not worth the API spend; this is scoped to upcoming ones only,
per the owner's own call ("Är det få, regenerera dem").

Also benefits from point 1 (commit 8935084): the event prompt no longer
asks the model to state any date/time/cadence/price/age in prose at all,
so a regenerated row can't carry the old bug's symptom forward even by
coincidence -- the new prose simply won't mention a date.

Each target row's events.id is read directly from its own slug
("event-<id>" -- confirmed live that stories never rewrites this numeric
suffix after publish, see content-slugs.ts's own docstring for the
general rule), used to re-fetch the ORIGINAL staging `events` row (never
pruned) and rebuild the exact ai_record shape ai_pipeline/publish.py's
own publish_table() builds, then regenerate via format_record() and
UPDATE just `body`/`generated_by`/`verified` -- occurs_at, slug, venue_raw
and everything else stay untouched. A `generated_by == "template_fallback"`
result (both AI attempts rejected) is NOT written back -- that would
replace a real, if stale, blurb with a bare title-only fallback, worse
than leaving the stale one for manual review.

is_recurring_series rows are OUT OF SCOPE here -- their source "record" is
a many-row merge built fresh by group_recurring_events() each publish run,
not a single events row this script can cheaply reconstruct. Reported,
not silently skipped.

Usage:
    python -m scripts.regenerate_stale_event_bodies --dry-run
    python -m scripts.regenerate_stale_event_bodies
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from ai_pipeline.format_prompt import format_record
from ai_pipeline.publish import _INTERNAL_FIELDS, _localize_datetime_fields
from db.db import get_conn

FIX_COMMIT_TS = "2026-10-08T05:02:42Z"  # 28d1128's own commit timestamp, UTC
CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


def find_affected_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT town_id, slug, title, occurs_at, published_at
              FROM stories
             WHERE source_type = 'event' AND published_at IS NOT NULL
               AND superseded_by_slug IS NULL
               AND published_at < %s
               AND occurs_at >= now() - interval '12 hours'
            """,
            (FIX_COMMIT_TS,),
        )
        rows = [
            {"town_id": r[0], "slug": r[1], "title": r[2], "occurs_at": r[3], "published_at": r[4]}
            for r in cur.fetchall()
        ]

    tz_by_town = {
        "brookings_sd": ZoneInfo("America/Chicago"),
        "moreno_valley_ca": ZoneInfo("America/Los_Angeles"),
        "broomfield_co": ZoneInfo("America/Denver"),
    }
    affected = []
    for r in rows:
        tz = tz_by_town[r["town_id"]]
        if r["occurs_at"].astimezone(tz).date() != r["occurs_at"].date():
            affected.append(r)
    return affected


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    configs: dict[str, dict] = {}

    with get_conn() as conn:
        affected = find_affected_rows(conn)
        print(f"{len(affected)} upcoming, pre-fix, day-boundary-crossing event row(s) found.")

        series = [r for r in affected if r["slug"].startswith("event-series-")]
        individual = [r for r in affected if not r["slug"].startswith("event-series-")]
        if series:
            print(f"\n{len(series)} is_recurring_series row(s) OUT OF SCOPE (needs a full merge "
                  f"rebuild, not a single events row) -- left untouched, for manual follow-up:")
            for r in series:
                print(f"  {r['town_id']}: {r['slug']!r}  ({r['title']!r})")

        print(f"\n{len(individual)} individual row(s) will be regenerated:")
        for r in individual:
            print(f"  {r['town_id']}: {r['slug']!r}  ({r['title']!r})")

        if args.dry_run:
            print("\n(dry-run -- no AI calls made, nothing changed)")
            return 0

        updated, skipped_fallback, skipped_missing = 0, 0, 0
        with conn.cursor(row_factory=None) as cur:
            import psycopg.rows
            cur.row_factory = psycopg.rows.dict_row
            for r in individual:
                town_id, slug = r["town_id"], r["slug"]
                events_id = int(slug.split("-")[1])
                cur.execute("SELECT * FROM events WHERE id = %s AND town_id = %s", (events_id, town_id))
                row = cur.fetchone()
                if row is None:
                    print(f"  SKIP {slug}: no matching events.id={events_id} row found (pruned?)")
                    skipped_missing += 1
                    continue

                if town_id not in configs:
                    configs[town_id] = json.loads((CONFIG_DIR / f"{town_id}.json").read_text(encoding="utf-8"))
                cfg = configs[town_id]
                tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))

                ai_record = {k: v for k, v in row.items() if k not in _INTERNAL_FIELDS}
                ai_record = _localize_datetime_fields(ai_record, tz)
                result = format_record(ai_record, "event", cfg)

                if result.generated_by == "template_fallback":
                    print(f"  SKIP {slug}: regeneration fell back to template_fallback "
                          f"(both AI attempts rejected: {result.violations}) -- not written back")
                    skipped_fallback += 1
                    continue

                cur.execute(
                    "UPDATE stories SET body = %s, generated_by = %s, verified = %s WHERE town_id = %s AND slug = %s",
                    (result.text, result.generated_by, result.verified, town_id, slug),
                )
                print(f"  OK {slug}: regenerated ({result.generated_by})")
                updated += 1
        conn.commit()
        print(f"\n{updated} row(s) regenerated and updated, {skipped_fallback} fell back to "
              f"template (not written), {skipped_missing} had no matching events row.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
