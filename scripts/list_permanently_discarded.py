"""Lists records publish.py has permanently given up on (NEEDS-HUMAN-REVIEW.md
#77/#78, ai_pipeline/publish.py's MAX_CONSECUTIVE_DISCARDS) -- i.e. rows in
publish_discard_streak with consecutive_runs >= the give-up threshold.

Read-only: writes nothing, just reports what's accumulated so a human can
decide whether to manually fix/publish a record, delete it from the raw
source table, or adjust whichever guardrail keeps rejecting it. The pipeline
itself already fires an ALERT_WEBHOOK the moment a record crosses the
threshold (see publish.py's _alert() call) -- this is for the periodic
"what's the current backlog of these" review, not the real-time notification.

Usage:
    python -m scripts.list_permanently_discarded
    python -m scripts.list_permanently_discarded --town brookings_sd
    python -m scripts.list_permanently_discarded --since 7d
"""
from __future__ import annotations

import argparse
import re
from datetime import datetime, timedelta, timezone

from db.db import get_conn


def _parse_since(value: str) -> timedelta:
    match = re.fullmatch(r"(\d+)([dh])", value.strip())
    if not match:
        raise argparse.ArgumentTypeError(f"--since must look like '7d' or '48h', got {value!r}")
    amount, unit = match.groups()
    return timedelta(days=int(amount)) if unit == "d" else timedelta(hours=int(amount))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--town", help="restrict to one town_id (default: all)")
    ap.add_argument("--since", type=_parse_since, default=None,
                    help="only records last discarded within this window, e.g. '7d' or '48h' "
                         "(default: no limit -- the table only ever holds currently-stuck records anyway)")
    args = ap.parse_args()

    query = """
        SELECT town_id, source_type, record_id, consecutive_runs,
               first_discarded_at, last_discarded_at, last_reject_reason
        FROM publish_discard_streak
        WHERE consecutive_runs >= 3
    """
    params: list = []
    if args.town:
        query += " AND town_id = %s"
        params.append(args.town)
    if args.since:
        query += " AND last_discarded_at >= %s"
        params.append(datetime.now(timezone.utc) - args.since)
    query += " ORDER BY town_id, last_discarded_at DESC"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    if not rows:
        print("No permanently-discarded records found.")
        return 0

    for town_id, source_type, record_id, streak, first_at, last_at, reason in rows:
        stuck_for = last_at - first_at
        print(f"[{town_id}] {source_type} #{record_id} -- {streak} consecutive runs, "
              f"first discarded {first_at:%Y-%m-%d}, last {last_at:%Y-%m-%d} "
              f"(stuck {stuck_for.days}d)")
        print(f"  last_reject_reason: {reason}")
        print()

    print(f"{len(rows)} record(s) total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
