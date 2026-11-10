"""Watchdog: fails loudly (red X + one GitHub issue per stale item) when a data job that is meant to run on its own has stopped.

The scrape watchdog (check_scrape_liveness.py) covers the twice-daily scrape. This one covers the rest, each with its own check id so the
issues are independent (qa/report.py `scope_checks`: a run of this script only ever opens/closes ops.*-freshness / token issues):

  ops.sport-freshness    sport_sources_health.last_success per ACTIVE sports source (configs sports.enabled or sports.collect)        26 h  (one daily run, 17:00 UTC)
  ops.sport-warning      a `warning:` in sport_sources_health.last_error (a page skipped, a guard that held rows back) that has lasted > 3 days
                         unchanged; the source still counts as fresh, so only this check shows a sport page that fails every day
  ops.weather-freshness  weather_snapshots, newest row per town, payload->>'fetched_at' (written every whole hour)    3 h
  ops.alerts-freshness   dispatcher_heartbeat job 'alerts' per town (written by the Worker after each good 15-min fetch) 2 h
  ops.safety-freshness   dispatcher_heartbeat job 'safety' per safety town (wildfire + air quality)                    3 h
  ops.evening-register-freshness  evening_register_* per town with a register: too few venues with a valid rule, or no venue check for 9 days
                         (owner 2026-11-08: Glasgow < 4, Broomfield < 1; a dated rule counts 8 days, a recurring one 36)
  ops.token-expiry       the cron-dispatcher's GITHUB_TOKEN runs out: an issue opens TOKEN_WARN_DAYS before TOKEN_EXPIRES

Runs on GitHub's own schedule (.github/workflows/freshness-check.yml), not from the Worker: a dead Worker must not silence its own alarm.
The `events` table cannot show alerts liveness (rows are written only when a warning changes); hence the heartbeat table (migration 069).

Usage:
    python -m scripts.check_freshness                  # everything
    python -m scripts.check_freshness --only sport weather
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from db.db import get_conn
from qa.report import report

ROOT = Path(__file__).resolve().parent.parent

# The cron-dispatcher's GITHUB_TOKEN (fine-grained PAT, Actions: write) expires on this date (recorded 2026-10-21, one year). Change it here
# when the token is renewed; tests/test_freshness.py pins the arithmetic.
TOKEN_EXPIRES = date(2027, 10, 21)
TOKEN_WARN_DAYS = 30  # the issue opens on 2027-09-21

LIMIT_HOURS = {"sport": 26, "weather": 3, "alerts": 2, "safety": 3}
SPORT_WARNING_DAYS = 3
CHECK_ID = {"sport": "ops.sport-freshness", "sportwarn": "ops.sport-warning", "weather": "ops.weather-freshness", "alerts": "ops.alerts-freshness",
            "safety": "ops.safety-freshness", "register": "ops.evening-register-freshness", "token": "ops.token-expiry"}
FRESHNESS_CHECKS = set(CHECK_ID.values())

# Which towns the Worker runs each job for. Mirrors cron-dispatcher/src/{alerts,weather,safety}/towns.ts
# (tests/test_freshness.py fails when they drift apart). Safety is only Moreno Valley and Broomfield.
WEATHER_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
ALERT_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
SAFETY_TOWNS = ["moreno_valley_ca", "broomfield_co"]
ALL_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
TOKEN_TOWN = "dispatcher"  # the token finding belongs to no town

# Evening register (scripts/refresh_evening_register.py, weekly Monday 11:00 UTC). The site shows a dated rule while it was confirmed <= 7 days
# ago and a recurring one <= 35 (migration 064); the check adds a day of margin to each, because the Monday run lands exactly on the 7-day edge
# and would otherwise open an issue every week. Minimums are the owner's (2026-11-08); baseline then: Glasgow 7 venues with rules, Broomfield 1.
REGISTER_MIN_VENUES = {"glasgow": 4, "broomfield_co": 1}
REGISTER_DATED_DAYS = 8
REGISTER_RECURRING_DAYS = 36
REGISTER_CHECK_MAX_DAYS = 9
REGISTER_PATTERN = "evening-register"  # both findings of a town share it, so they land in one issue


def is_stale(last: datetime | None, now: datetime, max_hours: float) -> bool:
    """True when there is no success at all or the newest one is older than max_hours. Pure, so it is tested without a DB."""
    return last is None or now - last > timedelta(hours=max_hours)


def age_text(last: datetime | None, now: datetime) -> str:
    return "never" if last is None else f"{(now - last).total_seconds() / 3600:.1f} h ago"


def sport_sources(configs_dir: Path = ROOT / "configs") -> list[tuple[str, str]]:
    """(town_id, source_id) for every source of every town whose config has sports.enabled or sports.collect; source_id as sports/runner.py names it."""
    out: list[tuple[str, str]] = []
    for town in ALL_TOWNS:
        block = json.loads((configs_dir / f"{town}.json").read_text(encoding="utf-8")).get("sports") or {}
        if block.get("enabled") is True or block.get("collect") is True:
            out += [(town, f"{s['adapter']}:{s.get('program', '*')}") for s in block.get("sources", [])]
    return out


def register_towns(configs_dir: Path = ROOT / "configs") -> list[str]:
    """Towns whose config has a venue register (evening_register.venues), in ALL_TOWNS order."""
    return [t for t in ALL_TOWNS if (json.loads((configs_dir / f"{t}.json").read_text(encoding="utf-8")).get("evening_register") or {}).get("venues")]


def valid_register_venues(rows: list[tuple], now: datetime) -> set[str]:
    """venue_id of every venue with at least one rule (venue_id, kind, last_confirmed_at) inside its margin. Pure, so it is tested without a DB."""
    days = {"dated": REGISTER_DATED_DAYS, "recurring": REGISTER_RECURRING_DAYS}
    return {venue for venue, kind, confirmed in rows if kind in days and confirmed is not None and now - confirmed <= timedelta(days=days[kind])}


def register_findings(town: str, valid: int, last_check: datetime | None, now: datetime) -> list[dict]:
    """Up to two findings (too few venues with a valid rule; no venue check lately) with the same check id and pattern, so one issue."""
    base = {"check": CHECK_ID["register"], "town": town, "pattern": REGISTER_PATTERN, "path": f"/{town}/{REGISTER_PATTERN}"}
    out: list[dict] = []
    minimum = REGISTER_MIN_VENUES[town]
    if valid < minimum:
        out.append({**base, "message": f"only {valid} venue(s) have a valid register rule (minimum {minimum}; a dated rule counts {REGISTER_DATED_DAYS} days, "
                                       f"a recurring one {REGISTER_RECURRING_DAYS}). Check the evening-register workflow run and evening_register_venues.status_reason."})
    if last_check is None or now - last_check > timedelta(days=REGISTER_CHECK_MAX_DAYS):
        out.append({**base, "message": f"last venue check {age_text(last_check, now)} (limit {REGISTER_CHECK_MAX_DAYS} days). The weekly evening-register "
                                       "workflow (Mondays 11:00 UTC, started by the dispatcher) has not written evening_register_venues."})
    return out


def sport_warning_finding(town: str, source_id: str, last_error: str | None, since: datetime | None, now: datetime) -> dict | None:
    """A finding when the source's last_error is a `warning:` that first appeared more than SPORT_WARNING_DAYS ago (the store keeps the time of the
    first identical warning). Pure, so it is tested without a DB. An error ('RuntimeError: ...', 'skipped: ...') is not a warning: a failed run is
    already the freshness check's business."""
    if not last_error or not last_error.startswith("warning:") or since is None or now - since <= timedelta(days=SPORT_WARNING_DAYS):
        return None
    days = (now - since).total_seconds() / 86400
    return {"check": CHECK_ID["sportwarn"], "town": town, "pattern": source_id, "path": f"/{town}/{source_id}",
            "message": f"{source_id}: the same warning has been in sport_sources_health.last_error for {days:.1f} days (limit {SPORT_WARNING_DAYS}): "
                       f"{last_error[:300]} Part of the schedule is not being read; check the brookingsview sports workflow log."}


def token_findings(today: date) -> list[dict]:
    left = (TOKEN_EXPIRES - today).days
    if left > TOKEN_WARN_DAYS:
        return []
    when = f"expires in {left} days" if left > 0 else "has expired" if left < 0 else "expires today"
    return [{"check": CHECK_ID["token"], "town": TOKEN_TOWN, "pattern": "GITHUB_TOKEN", "path": "/cron-dispatcher",
             "message": f"The cron-dispatcher's GITHUB_TOKEN {when} ({TOKEN_EXPIRES.isoformat()}). Create a new fine-grained token (this repo only, "
                        "Actions: read and write), run `npx wrangler secret put GITHUB_TOKEN` in cron-dispatcher/, then update TOKEN_EXPIRES in "
                        "scripts/check_freshness.py."}]


_HINT = {"sport": " Check the brookings-sports workflow run and sport_sources_health.last_error.",
         "weather": " Check the cron-dispatcher Worker's logs (forecast fetch) and weather_snapshots.",
         "alerts": " Check the cron-dispatcher Worker's logs and dispatcher_heartbeat.last_error.",
         "safety": " Check the cron-dispatcher Worker's logs and dispatcher_heartbeat.last_error."}


def stale_finding(kind: str, town: str, what: str, last: datetime | None, now: datetime) -> dict:
    return {"check": CHECK_ID[kind], "town": town, "pattern": what, "path": f"/{town}/{what}",
            "message": f"{what}: last success {age_text(last, now)} (limit {LIMIT_HOURS[kind]} h)." + _HINT[kind]}


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def collect(conn, now: datetime, only: set[str], today: date) -> tuple[list[dict], list[str]]:
    findings: list[dict] = []
    lines: list[str] = []

    def judge(kind: str, town: str, what: str, last: datetime | None) -> None:
        stale = is_stale(last, now, LIMIT_HOURS[kind])
        lines.append(f"  [freshness] {kind} {town}/{what}: {'STALE' if stale else 'ok'} -- {age_text(last, now)}")
        if stale:
            findings.append(stale_finding(kind, town, what, last, now))

    if "sport" in only:
        for town, source_id in sport_sources():
            row = conn.execute("SELECT last_success FROM sport_sources_health WHERE town_id = %s AND source_id = %s", (town, source_id)).fetchone()
            judge("sport", town, source_id, row[0] if row else None)
    if "sportwarn" in only:
        for town, source_id in sport_sources():
            row = conn.execute("SELECT last_error, last_error_at FROM sport_sources_health WHERE town_id = %s AND source_id = %s", (town, source_id)).fetchone()
            found = sport_warning_finding(town, source_id, row[0] if row else None, row[1] if row else None, now)
            lines.append(f"  [freshness] sportwarn {town}/{source_id}: {'ISSUE' if found else 'ok'}")
            if found:
                findings.append(found)
    if "weather" in only:
        for town in WEATHER_TOWNS:
            row = conn.execute("SELECT payload->>'fetched_at' FROM weather_snapshots WHERE town_id = %s ORDER BY observed_for DESC LIMIT 1", (town,)).fetchone()
            judge("weather", town, "weather", _parse_ts(row[0]) if row else None)
    for kind, towns in (("alerts", ALERT_TOWNS), ("safety", SAFETY_TOWNS)):
        if kind in only:
            for town in towns:
                row = conn.execute("SELECT last_ok FROM dispatcher_heartbeat WHERE town_id = %s AND job = %s", (town, kind)).fetchone()
                judge(kind, town, kind, row[0] if row else None)
    if "register" in only:
        for town in register_towns():
            rows = conn.execute("SELECT e.venue_id, e.kind, e.last_confirmed_at FROM evening_register_entries e "
                                "JOIN evening_register_venues v ON v.town_id = e.town_id AND v.venue_id = e.venue_id "
                                "WHERE e.town_id = %s AND v.status = 'ok' AND e.active", (town,)).fetchall()
            row = conn.execute("SELECT max(checked_at) FROM evening_register_venues WHERE town_id = %s", (town,)).fetchone()
            last = row[0] if row else None
            valid = len(valid_register_venues(rows, now))
            found = register_findings(town, valid, last, now)
            lines.append(f"  [freshness] register {town}: {'STALE' if found else 'ok'} -- {valid} venue(s) with a valid rule (min {REGISTER_MIN_VENUES[town]}), "
                         f"last check {age_text(last, now)}")
            findings += found
    if "token" in only:
        t = token_findings(today)
        lines.append(f"  [freshness] token: {'ISSUE' if t else 'ok'} -- expires {TOKEN_EXPIRES.isoformat()}")
        findings += t
    return findings, lines


def _alert(msg: str) -> None:
    print(f"ALERT: {msg}", file=sys.stderr)
    hook = os.environ.get("ALERT_WEBHOOK")
    if hook:
        try:
            import requests
            requests.post(hook, json={"text": msg}, timeout=10)
        except Exception:  # pragma: no cover
            pass


def _run_url() -> str:
    repo, run = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    return f"https://github.com/{repo}/actions/runs/{run}" if repo and run else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", nargs="+", choices=sorted(CHECK_ID), help="run just these checks (default: all)")
    args = ap.parse_args()
    only = set(args.only or CHECK_ID)
    now = datetime.now(timezone.utc)
    with get_conn() as conn:
        findings, lines = collect(conn, now, only, now.date())
    print("\n".join(lines))
    only_checks = {CHECK_ID[k] for k in only}
    try:  # always called (also with no findings) so a fixed item closes its own issue; only this script's own check ids are in scope
        report(findings, report_only=False, scope_towns=set(ALL_TOWNS) | {TOKEN_TOWN}, clean_to_close=2, run_url=_run_url(),
               scope_checks=lambda c: c in only_checks)
    except Exception as exc:  # pragma: no cover -- the red X below must never depend on GitHub's API
        print(f"  [freshness] issue reporting failed: {exc}", file=sys.stderr)
    if findings:
        _alert("Stale data jobs:\n  " + "\n  ".join(f"{f['check']} {f['town']}: {f['message']}" for f in findings))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
