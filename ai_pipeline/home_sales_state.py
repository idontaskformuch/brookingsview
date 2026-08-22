"""Three-state classification for a home-sales month page: `released_with_data`,
`released_zero`, or `not_yet_released` -- never a silent blank.

ROOT CAUSE THIS REPLACES: the old `missing_trailing_months()` heuristic (still
in ai_pipeline/home_sales_digest.py's git history) only looked at whether a
month was STRICTLY AFTER the latest month with data. That made an interior
gap (Sept 2025 sitting between Aug and Oct, both populated) invisible to the
"not yet available" logic entirely -- it neither got a real digest nor a
pending notice, just silence. Investigated directly against the source file
(data/property_sales/moreno_valley_ca/447569.xlsx): Riverside County's own
countywide RecordDate range in that file reaches 2025-12-24, well past
September -- so the county HAS published data covering that month, and
Moreno Valley genuinely had zero qualifying residential sales recorded for
it (one raw MV row exists for Sept 2025 and it has Consideration=0, i.e. a
non-arms-length transfer, filtered out same as any other month). This is the
"released + genuinely zero" state the audit asked to distinguish, not a
pipeline bug.

The classification below is driven entirely by `property_sales_ingests`
(see db/migrations/019_property_sales_ingest_metadata.sql) -- the countywide
(unfiltered by city) RecordDate window of the most recent quarterly pull --
never by hardcoded dates. A month with zero Moreno Valley rows is
"released_zero" if the ingest window already reaches past that month's end
(the county's data provably covers it and just has nothing for us), or
"not_yet_released" if the window doesn't reach that far yet (or no ingest
has ever run).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum


class MonthState(str, Enum):
    RELEASED_WITH_DATA = "released_with_data"
    RELEASED_ZERO = "released_zero"
    NOT_YET_RELEASED = "not_yet_released"


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def latest_ingest_window(conn, town_id: str) -> tuple[date | None, date | None]:
    """(window_start, window_end) of the most recent reconcile run, or
    (None, None) if scripts/reconcile_property_sales.py has never run for
    this town."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT window_start, window_end FROM property_sales_ingests
             WHERE town_id = %s
             ORDER BY ingested_at DESC LIMIT 1
            """,
            (town_id,),
        )
        row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def _count_month(conn, town_id: str, year: int, month: int) -> int:
    start, end = month_bounds(year, month)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM property_sales
             WHERE town_id = %s AND sale_date >= %s AND sale_date < %s
            """,
            (town_id, start, end),
        )
        return cur.fetchone()[0]


def resolve_state(sales_count: int, year: int, month: int,
                   window_end: date | None) -> MonthState:
    """Pure decision logic, no DB access -- kept separate from classify_month()
    so it's directly unit-testable (see tests/test_home_sales_state.py)."""
    if sales_count > 0:
        return MonthState.RELEASED_WITH_DATA

    if window_end is None:
        # No reconcile has ever run -- we have no basis to claim "genuinely
        # zero", so treat conservatively as not yet released.
        return MonthState.NOT_YET_RELEASED

    _, month_end_exclusive = month_bounds(year, month)
    last_day_of_month = date.fromordinal(month_end_exclusive.toordinal() - 1)
    if last_day_of_month <= window_end:
        return MonthState.RELEASED_ZERO
    return MonthState.NOT_YET_RELEASED


def classify_month(conn, town_id: str, year: int, month: int,
                    sales_count: int | None = None) -> MonthState:
    """Resolve one calendar month into exactly one of the three states.

    `sales_count` lets a caller that already fetched the month's rows (e.g.
    home_sales_digest.py, which needs the full row list anyway) skip a
    redundant COUNT(*) query -- pass len(sales) from collect_month().
    """
    if sales_count is None:
        sales_count = _count_month(conn, town_id, year, month)
    if sales_count > 0:
        return MonthState.RELEASED_WITH_DATA

    _, window_end = latest_ingest_window(conn, town_id)
    return resolve_state(sales_count, year, month, window_end)


def months_in_range(conn, town_id: str) -> list[tuple[int, int]]:
    """Every (year, month) from the earliest month with ANY property_sales
    row through the current month -- the full span a month page could ever
    need to exist for. Empty if the town has no property_sales data at all
    (nothing to classify yet)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT min(sale_date) FROM property_sales
             WHERE town_id = %s AND sale_date IS NOT NULL
            """,
            (town_id,),
        )
        row = cur.fetchone()
    earliest = row[0] if row else None
    if earliest is None:
        return []

    now = datetime.now(timezone.utc)
    y, m = earliest.year, earliest.month
    out: list[tuple[int, int]] = []
    while (y, m) <= (now.year, now.month):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out
