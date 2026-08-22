"""Quarterly-aware reconcile pass for Riverside County property sales.

WHY THIS EXISTS, SEPARATE FROM scrapers.runner: rivco_property_sales_v1.py's
generic runner path (content_hash + DO NOTHING) answers "did I see this row
before", which is enough for sources that never revise old rows. Property
sales aren't like that -- the county's file is a ROLLING 2-YEAR WINDOW, so
every quarterly pull re-covers months we've already ingested, and a deed
recorded late can surface in a LATER file than the month it belongs to. This
script does the two things the generic path can't:

  1. Upsert by the real identity (town_id, pin, doc_number) with DO UPDATE,
     so a re-pull heals/corrects existing rows instead of only adding new
     ones -- and reports exactly how many rows were inserted vs. updated,
     and which (year, month) digests need regenerating as a result.
  2. Record ingest metadata (property_sales_ingests): the countywide
     (unfiltered) RecordDate window this pull actually covers. That window
     is the sole input to ai_pipeline.home_sales_state.classify_month --
     it's what lets a month with zero matching rows be told apart as
     "genuinely zero" vs. "county hasn't published that far yet" without
     ever hardcoding a date.

Run after a human drops a new quarterly .xlsx in the source's local_dir (see
scrapers/parsers/rivco_property_sales_v1.py's module docstring for why this
is manual -- rivcoacr.org blocks AI agents by robots.txt, deliberately not
worked around here). Safe to re-run against the same file: idempotent.

Usage:
    python -m scripts.reconcile_property_sales --config configs/moreno_valley_ca.json
"""
from __future__ import annotations

import argparse
import json
from calendar import month_name
from pathlib import Path

from psycopg.types.json import Jsonb

from db.db import get_conn, save_snapshot
from scrapers.parsers.rivco_property_sales_v1 import latest_file, parse_workbook


def reconcile(conn, town_id: str, source_cfg: dict, cfg: dict) -> dict:
    local_dir = source_cfg["local_dir"]
    path = latest_file(local_dir)
    target_city = source_cfg.get("city") or cfg.get("display_name") or ""

    parsed = parse_workbook(path, target_city)

    with open(path, "rb") as f:
        raw = f.read()
    snapshot_id = save_snapshot(conn, town_id, "property_sales", path, raw,
                                 "application/vnd.openxmlformats")

    inserted = 0
    updated = 0
    changed_months: set[tuple[int, int]] = set()
    skipped = 0

    with conn.cursor() as cur:
        for rec in parsed.records:
            if not rec.get("pin") or not rec.get("doc_number"):
                # Verified absent in every row of the file this was built
                # against (see parser module docstring) -- if the county
                # ever ships a row missing either, upserting it against a
                # NULL-inclusive conflict target would never dedup (NULL <>
                # NULL), silently duplicating on every future re-pull. Skip
                # and surface it instead of guessing an identity.
                skipped += 1
                print(f"  SKIPPED (missing pin/doc_number): {rec.get('address')}")
                continue

            cur.execute(
                """
                INSERT INTO property_sales
                    (town_id, address, sale_price, sale_date, pin, doc_number,
                     record_date, raw_data, content_hash, snapshot_id)
                VALUES (%(town_id)s, %(address)s, %(sale_price)s, %(sale_date)s,
                        %(pin)s, %(doc_number)s, %(record_date)s, %(raw_data)s,
                        %(content_hash)s, %(snapshot_id)s)
                ON CONFLICT (town_id, pin, doc_number) DO UPDATE SET
                    address = EXCLUDED.address,
                    sale_price = EXCLUDED.sale_price,
                    sale_date = EXCLUDED.sale_date,
                    record_date = EXCLUDED.record_date,
                    raw_data = EXCLUDED.raw_data,
                    content_hash = EXCLUDED.content_hash,
                    snapshot_id = EXCLUDED.snapshot_id
                RETURNING (xmax = 0) AS was_insert, sale_date
                """,
                {**rec, "town_id": town_id, "snapshot_id": snapshot_id,
                 "raw_data": Jsonb(rec["raw_data"], dumps=lambda o: json.dumps(o, default=str))},
            )
            was_insert, sale_date = cur.fetchone()
            if was_insert:
                inserted += 1
            else:
                updated += 1
            if sale_date is not None:
                changed_months.add((sale_date.year, sale_date.month))

        cur.execute(
            """
            INSERT INTO property_sales_ingests
                (town_id, source_file, file_mtime, window_start, window_end,
                 rows_seen, rows_matched, rows_inserted, rows_updated)
            VALUES (%s, %s, to_timestamp(%s), %s, %s, %s, %s, %s, %s)
            """,
            (town_id, Path(path).name, Path(path).stat().st_mtime,
             parsed.window_start, parsed.window_end,
             parsed.rows_seen, parsed.rows_matched, inserted, updated),
        )

    conn.commit()

    return {
        "source_file": Path(path).name,
        "rows_seen": parsed.rows_seen,
        "rows_matched": parsed.rows_matched,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "window_start": parsed.window_start,
        "window_end": parsed.window_end,
        "changed_months": sorted(changed_months),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    source_cfg = cfg["data_sources"]["property_sales"]

    with get_conn() as conn:
        report = reconcile(conn, town_id, source_cfg, cfg)

    print(f"\nReconciled against {report['source_file']}")
    print(f"  countywide rows seen:      {report['rows_seen']}")
    print(f"  {cfg['display_name']} residential matches: {report['rows_matched']}")
    print(f"  inserted: {report['inserted']}  |  updated: {report['updated']}  |  skipped: {report['skipped']}")
    print(f"  countywide RecordDate window: {report['window_start']} .. {report['window_end']}")
    if report["changed_months"]:
        print("  months with new/changed rows this run:")
        for y, m in report["changed_months"]:
            print(f"    {month_name[m]} {y}")
    else:
        print("  no months changed (file already fully reconciled)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
