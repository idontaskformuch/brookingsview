"""One-time backfill: re-run the FAS 2 category/salary sanitization
(scrapers/parsers/jobs_v1.py:_classify_category/_sanitize_salary) against
ALREADY-STORED `jobs` rows.

Why this exists: jobs is append-only (ON CONFLICT (town_id, external_job_id)
DO NOTHING, see migration 012) -- the parser fix only cleans rows scraped
FROM NOW ON. Rows written before the fix keep Adzuna's raw category
("Other/General Jobs" etc.) and raw salary_min=0 rows forever unless
explicitly corrected here. No new API calls -- this only rewrites columns
already in the DB from the row's own `title`.

Usage:
    python -m scripts.backfill_jobs_categories          # both towns
    python -m scripts.backfill_jobs_categories --town moreno_valley_ca
    python -m scripts.backfill_jobs_categories --dry-run
"""
from __future__ import annotations

import argparse

from db.db import get_conn
from scrapers.parsers.jobs_v1 import _classify_category, _sanitize_salary


def backfill(conn, town_id: str | None, dry_run: bool) -> int:
    with conn.cursor() as cur:
        if town_id:
            cur.execute(
                "SELECT id, title, category, salary_min, salary_max, raw_data FROM jobs WHERE town_id = %s",
                (town_id,),
            )
        else:
            cur.execute("SELECT id, title, category, salary_min, salary_max, raw_data FROM jobs")
        rows = cur.fetchall()

        changed = 0
        for job_id, title, category, salary_min, salary_max, raw_data in rows:
            adzuna_label = ((raw_data or {}).get("category") or {}).get("label")
            new_category = _classify_category(title, adzuna_label)
            new_min, new_max = _sanitize_salary(salary_min, salary_max)

            if new_category == category and new_min == salary_min and new_max == salary_max:
                continue
            changed += 1
            print(f"  #{job_id} {title!r}: category {category!r} -> {new_category!r}, "
                  f"salary {salary_min}-{salary_max} -> {new_min}-{new_max}")
            if not dry_run:
                cur.execute(
                    "UPDATE jobs SET category = %s, salary_min = %s, salary_max = %s WHERE id = %s",
                    (new_category, new_min, new_max, job_id),
                )
        return changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with get_conn() as conn:
        changed = backfill(conn, args.town, args.dry_run)
        verb = "would change" if args.dry_run else "changed"
        print(f"{verb} {changed} row(s).")


if __name__ == "__main__":
    main()
