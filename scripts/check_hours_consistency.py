"""READ-ONLY invariant (Q3 2026-10-23): for every place, the three representations of its opening hours must agree.

    hours_text        the human-written line ("Mon-Thu 8am-5pm, Fri 8am-noon")
    hours_structured  JSONB per weekday, derived from hours_text by ai_pipeline/facility_hours.py
    place_hours       one row per weekday (the table the facility page and the open/closed badge read)

Found 2026-10-23: Brookings city-hall and public-library had a corrected hours_text (2026-10-15) while hours_structured and
place_hours still carried the old, wrong times (7:00 / 21:00), so the page showed "Closed" and a table that contradicted its own
first paragraph. This script lists every such disagreement; it never writes.

    python -m scripts.check_hours_consistency            # all towns
    python -m scripts.check_hours_consistency brookings_sd
Exit code 1 when anything disagrees (usable as a QA/DB-invariant gate).
"""
from __future__ import annotations

import sys

from ai_pipeline.facility_hours import parse_hours_text
from db.db import get_conn

DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def _hhmm(value) -> str | None:
    return None if value is None else str(value)[:5]


def table_to_structured(rows) -> dict:
    """place_hours rows (day_of_week 0=Sunday) -> {'monday': ['08:00','17:00'] | None, ...} (same shape as hours_structured)."""
    out = {d: None for d in DAYS}
    for day_of_week, opens, closes in rows:
        out[DAYS[day_of_week]] = None if opens is None or closes is None else [_hhmm(opens), _hhmm(closes)]
    return out


def compare(a: dict | None, b: dict | None) -> list[str]:
    """Human-readable differences between two weekday maps (missing key == closed)."""
    a = a or {}
    b = b or {}
    diffs = []
    norm = lambda v: list(v) if v else None  # parsed hours are tuples, JSONB gives lists
    for d in DAYS:
        if norm(a.get(d)) != norm(b.get(d)):
            diffs.append(f"{d}: {a.get(d)} vs {b.get(d)}")
    return diffs


def main(argv: list[str]) -> int:
    towns = argv or None
    bad = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, town_id, slug, hours_text, hours_structured FROM places "
                    "WHERE hours_text IS NOT NULL ORDER BY town_id, slug")
        for pid, town, slug, text, structured in cur.fetchall():
            if towns and town not in towns:
                continue
            parsed = parse_hours_text(text)
            cur2 = conn.cursor()
            cur2.execute("SELECT day_of_week, opens, closes FROM place_hours WHERE place_id = %s", (pid,))
            rows = cur2.fetchall()
            problems = []
            if parsed.structured is not None:
                d1 = compare(parsed.structured, structured)
                if d1:
                    problems.append("hours_structured != hours_text: " + "; ".join(d1))
                if rows:
                    d2 = compare(parsed.structured, table_to_structured(rows))
                    if d2:
                        problems.append("place_hours != hours_text: " + "; ".join(d2))
            if problems:
                bad += 1
                print(f"[MISMATCH] {town}/{slug}  hours_text={text!r}")
                for p in problems:
                    print(f"    {p}")
    print(f"\n{bad} place(s) with disagreeing hours")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
