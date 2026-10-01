"""Source-staleness alerting.

Added 2026-10-01 after diagnosing Moreno Valley's eSCRIBE meetings
scraper: the scrape cron had been running successfully, on schedule,
every single time -- but the live eSCRIBE calendar itself had simply
stopped having any meeting posted past 2026-09-24 (verified directly
against the real API, not a scraper bug: a fresh fetch/parse returns the
exact same 13 records, newest Sept 24, for the real Aug 2 - Nov 15
window). scrapers/runner.py's existing alerting (_alert(), keyed off
consecutive_failures) only catches a scraper that's throwing exceptions --
it has no way to notice "ran fine, found zero new rows, data is going
stale," which is exactly what happened here for roughly a week before
anyone noticed.

This checks, per (town, source_key), whether the NEWEST value in that
source's own date column is older than a configurable threshold -- not
"time since last successful run" (a run can succeed while finding nothing
new), but "how old is the freshest thing we actually know about."

Configurable per source: each data_sources.<key> block in configs/<town>.json
may set "staleness_days": N to override the default for that specific
source; otherwise DEFAULT_STALENESS_DAYS below applies, keyed by source
KIND (source_key), not by platform -- so e.g. every town's meetings source
defaults the same regardless of which platform parser (Legistar/eSCRIBE/
AgendaLink/CivicEngage) handles it.

Deliberately NOT exhaustive: SOURCE_TABLES below only covers sources this
pass actually verified the right table/column for (meetings, events).
An unlisted source_key is silently skipped by check_all_sources() -- see
that function's own comment -- rather than guessed at. Extend the table as
more sources get verified.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

# source_key (as used in configs/<town>.json's data_sources) -> (table,
# column measuring "how recently did this source find something NEW").
#
# Deliberately `created_at` (row-discovery time), NOT meeting_date/starts_at
# (when the thing itself occurs) -- found live while verifying this module:
# events.starts_at's MAX() is skewed years into the future by recurring
# series pre-generated ahead of time ("Free Food Giveaway (Every Sunday)"
# had occurrences out to 2028), which would make the events check never
# fire no matter how long the scraper had actually been stuck. created_at
# is set once at INSERT and never touched again (every meetings/events
# parser's own conflict handling only updates the columns it explicitly
# lists, never created_at -- confirmed by reading each parser's own
# update_columns), so MAX(created_at) genuinely answers "when did we last
# discover something we hadn't seen before," immune to that skew.
#
# The threshold itself lives in DEFAULT_STALENESS_DAYS below, or a
# per-source "staleness_days" config override -- kept separate from this
# table so the same (table, column) pair can serve several source_keys
# with different defaults (county_meetings is rarer than city_meetings, so
# it gets a longer default leash) without duplicating the mapping.
SOURCE_TABLES: dict[str, tuple[str, str]] = {
    "city_meetings": ("meetings", "created_at"),
    "county_meetings": ("meetings", "created_at"),
    "events": ("events", "created_at"),
}

# Per the handoff's own examples: meetings 7 days, events 2 days.
# county_meetings gets a longer default (14) -- a county commission/school
# board meets less often than a city council, so the same 7-day leash
# would false-alarm on its normal cadence (confirmed against this
# project's own real county_meetings data before picking this number).
DEFAULT_STALENESS_DAYS: dict[str, int] = {
    "city_meetings": 7,
    "county_meetings": 14,
    "events": 2,
}


@dataclass
class StalenessResult:
    town_id: str
    source_key: str
    table: str
    newest: datetime | None
    threshold_days: int
    is_stale: bool

    @property
    def age_days(self) -> float | None:
        if self.newest is None:
            return None
        newest = self.newest if self.newest.tzinfo else self.newest.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - newest).total_seconds() / 86400


def check_source_staleness(conn, town_id: str, source_key: str, source_cfg: dict) -> StalenessResult | None:
    """None if source_key has no known (table, column) mapping -- nothing
    to check, not a guess. A None `newest` (the table has zero rows for
    this town) always counts as stale -- there is nothing to be fresh."""
    spec = SOURCE_TABLES.get(source_key)
    if spec is None:
        return None
    table, column = spec
    threshold_days = int(source_cfg.get("staleness_days", DEFAULT_STALENESS_DAYS.get(source_key, 7)))

    with conn.cursor() as cur:
        cur.execute(f"SELECT max({column}) FROM {table} WHERE town_id = %s", (town_id,))  # noqa: S608 -- table/column from a fixed internal mapping, never user input
        newest = cur.fetchone()[0]

    if newest is None:
        return StalenessResult(town_id, source_key, table, None, threshold_days, is_stale=True)
    newest_aware = newest if newest.tzinfo else newest.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - newest_aware).total_seconds() / 86400
    return StalenessResult(town_id, source_key, table, newest, threshold_days, is_stale=age_days >= threshold_days)


def check_all_sources(conn, cfg: dict) -> list[StalenessResult]:
    """Checks every ENABLED source in cfg's data_sources that has a known
    (table, column) mapping in SOURCE_TABLES -- an enabled source with no
    mapping (e.g. weather, jobs, traffic) is silently skipped, same
    "flagged gap, not a guess" discipline as the rest of this module."""
    town_id = cfg["town_id"]
    results = []
    for source_key, source_cfg in cfg.get("data_sources", {}).items():
        if not source_cfg.get("enabled", False):
            continue
        result = check_source_staleness(conn, town_id, source_key, source_cfg)
        if result is not None:
            results.append(result)
    return results


def _alert(stale: list[StalenessResult]) -> None:
    hook = os.environ.get("ALERT_WEBHOOK")
    lines = []
    for r in stale:
        age = f"{r.age_days:.1f}d" if r.newest is not None else "no rows at all"
        lines.append(f"  [{r.town_id}] '{r.source_key}' ({r.table}): newest is {age} old "
                     f"(threshold {r.threshold_days}d)")
    msg = "Source staleness detected:\n" + "\n".join(lines)
    print(f"ALERT: {msg}", file=sys.stderr)
    if hook:
        try:
            import requests
            requests.post(hook, json={"text": msg}, timeout=10)
        except Exception:  # pragma: no cover
            pass


def report_and_alert(conn, cfg: dict) -> bool:
    """Runs check_all_sources(), prints a line per checked source, alerts
    on any stale ones. Returns True if everything is fresh (so callers --
    see runner.py's main() -- can fail the run's exit code visibly on
    False, per the handoff's own "fails the daily run visibly" ask,
    instead of a staleness alert being easy to miss in scroll-back)."""
    results = check_all_sources(conn, cfg)
    stale = [r for r in results if r.is_stale]
    for r in results:
        status = "STALE" if r.is_stale else "ok"
        age = f"{r.age_days:.1f}d" if r.newest is not None else "no rows"
        print(f"  [staleness] {r.source_key} ({r.table}): {status} -- newest is {age} old "
              f"(threshold {r.threshold_days}d)")
    if stale:
        _alert(stale)
    return not stale
