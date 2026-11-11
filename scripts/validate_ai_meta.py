"""Runs the meta of the old model-written stories (generated_by 'ai:*', from before meta_only) through the same check new rows
get: ai_pipeline/meta_only.validate_meta against the text of the story's source row (owner 2026-11-11).

The site shows the meta of an ai:* story only when it carries "_checked": true (site/src/lib/db.ts, fail closed), so:
  * source row found, at least one value kept -> meta = the kept values + "_checked": true (written with --apply);
  * source row found, nothing kept            -> "stricken": left as it is, never shown;
  * no source row (deleted/re-keyed)          -> "no source text": left as it is, never shown.

Source text = guardrails.source_to_text of the row exactly as publish.py hands it to format_record (internal fields dropped,
datetimes localized to the town). The source row is the last segment of the slug ("event-123", "meeting-2026-08-25-10703",
"alert-55"): events for event/alert, meetings for meeting. Alerts have no meta keys, so all their meta is stricken.

Read-only by default: prints the counts per town (and per source type) and writes nothing.
Live DB (CLAUDE.md rule 14): back up first, then run with --prod and ALLOW_PROD_WRITE=validate_ai_meta:
    python -m scripts.prod_backup validate_ai_meta "SELECT id, town_id, slug, generated_by, meta FROM stories WHERE generated_by LIKE 'ai:%' AND meta IS NOT NULL AND meta::text NOT IN ('{}', 'null')"
    ALLOW_PROD_WRITE=validate_ai_meta python -m scripts.validate_ai_meta --prod --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from ai_pipeline import guardrails, meta_only
from ai_pipeline.publish import _INTERNAL_FIELDS, _localize_datetime_fields
from db.db import get_conn

CONFIGS = Path(__file__).resolve().parent.parent / "configs"
TABLE = {"event": "events", "alert": "events", "meeting": "meetings"}


def town_tz(town_id: str) -> ZoneInfo:
    return ZoneInfo(json.loads((CONFIGS / f"{town_id}.json").read_text(encoding="utf-8"))["timezone"])


def source_id(slug: str) -> int | None:
    m = re.search(r"-(\d+)$", slug)
    return int(m.group(1)) if m else None


def plan(conn) -> tuple[list[tuple[int, dict]], dict]:
    """(updates [(story_id, new_meta)], counts {town: Counter}) -- pure reads."""
    updates: list[tuple[int, dict]] = []
    counts: dict[str, Counter] = defaultdict(Counter)
    tz_cache: dict[str, ZoneInfo] = {}
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, town_id, slug, source_type, meta FROM stories
                WHERE generated_by LIKE 'ai:%%' AND meta IS NOT NULL AND meta::text NOT IN ('{}', 'null')
                ORDER BY town_id, id"""
        )
        stories = cur.fetchall()
        for sid, town, slug, stype, meta in stories:
            c = counts[town]
            c["total"] += 1
            if isinstance(meta, dict) and meta.get("_checked") is True:
                c["already checked"] += 1
                continue
            table, rid = TABLE.get(stype), source_id(slug)
            row = None
            if table and rid is not None:
                cur.execute(f"SELECT * FROM {table} WHERE town_id = %s AND id = %s", (town, rid))
                hit = cur.fetchone()
                if hit is not None:
                    row = dict(zip([d.name for d in cur.description], hit))
            if row is None:
                c["no source text"] += 1
                c[f"no source text: {stype}"] += 1
                continue
            tz = tz_cache.setdefault(town, town_tz(town))
            record = _localize_datetime_fields({k: v for k, v in row.items() if k not in _INTERNAL_FIELDS}, tz)
            kept, dropped = meta_only.validate_meta({k: v for k, v in (meta or {}).items() if not k.startswith("_")}, stype,
                                                    guardrails.source_to_text(record))
            c["values dropped"] += len(dropped)
            for key, _value, _why in dropped:
                c[f"dropped key: {key}"] += 1
            if kept:
                c["validated"] += 1
                c[f"validated: {stype}"] += 1
                updates.append((sid, {**kept, "_checked": True}))
            else:
                c["stricken"] += 1
                c[f"stricken: {stype}"] += 1
    return updates, counts


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="scripts.validate_ai_meta")
    ap.add_argument("--apply", action="store_true", help="write the kept values + _checked (needs --prod and ALLOW_PROD_WRITE=validate_ai_meta)")
    args = ap.parse_args(argv)
    with get_conn() as conn:
        updates, counts = plan(conn)
        for town in sorted(counts):
            c = counts[town]
            print(f"{town}: {c['total']} ai:* stories with meta -- validated {c['validated']}, stricken {c['stricken']}, "
                  f"no source text {c['no source text']}, already checked {c['already checked']} ({c['values dropped']} values dropped)")
            for k in sorted(k for k in c if ":" in k):
                print(f"    {k}: {c[k]}")
        if not args.apply:
            print(f"read-only: {len(updates)} row(s) would get their kept meta + _checked; nothing written")
            return 0
        with conn.cursor() as cur:
            for sid, new_meta in updates:
                cur.execute("UPDATE stories SET meta = %s WHERE id = %s AND generated_by LIKE 'ai:%%'", (Jsonb(new_meta), sid))
                if cur.rowcount != 1:
                    raise SystemExit(f"story {sid}: expected 1 row, got {cur.rowcount}; nothing committed")
        conn.commit()
        print(f"updated {len(updates)} row(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
