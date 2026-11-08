"""Watchdog: fails loudly (red X + one GitHub issue per stale item) when a data job that is meant to run on its own has stopped.

The scrape watchdog (check_scrape_liveness.py) covers the twice-daily scrape. This one covers the rest, each with its own check id so the
issues are independent (qa/report.py `scope_checks`: a run of this script only ever opens/closes ops.*-freshness / token issues):

  ops.sport-freshness    sport_sources_health.last_success per ACTIVE sports source (configs sports.enabled)        36 h  (one daily run)
  ops.weather-freshness  weather_snapshots, newest row per town, payload->>'fetched_at' (written every whole hour)    3 h
  ops.alerts-freshness   dispatcher_heartbeat job 'alerts' per town (written by the Worker after each good 15-min fetch) 2 h
  ops.safety-freshness   dispatcher_heartbeat job 'safety' per safety town (wildfire + air quality)                    3 h
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

LIMIT_HOURS = {"sport": 36, "weather": 3, "alerts": 2, "safety": 3}
CHECK_ID = {"sport": "ops.sport-freshness", "weather": "ops.weather-freshness", "alerts": "ops.alerts-freshness",
            "safety": "ops.safety-freshness", "token": "ops.token-expiry"}
FRESHNESS_CHECKS = set(CHECK_ID.values())

# Which towns the Worker runs each job for. Mirrors cron-dispatcher/src/{alerts,weather,safety}/towns.ts
# (tests/test_freshness.py fails when they drift apart). Safety is only Moreno Valley and Broomfield.
WEATHER_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
ALERT_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
SAFETY_TOWNS = ["moreno_valley_ca", "broomfield_co"]
ALL_TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
TOKEN_TOWN = "dispatcher"  # the token finding belongs to no town


def is_stale(last: datetime | None, now: datetime, max_hours: float) -> bool:
    """True when there is no success at all or the newest one is older than max_hours. Pure, so it is tested without a DB."""
    return last is None or now - last > timedelta(hours=max_hours)


def age_text(last: datetime | None, now: datetime) -> str:
    return "never" if last is None else f"{(now - last).total_seconds() / 3600:.1f} h ago"


def sport_sources(configs_dir: Path = ROOT / "configs") -> list[tuple[str, str]]:
    """(town_id, source_id) for every source of every town whose config has sports.enabled; source_id as sports/runner.py names it."""
    out: list[tuple[str, str]] = []
    for town in ALL_TOWNS:
        block = json.loads((configs_dir / f"{town}.json").read_text(encoding="utf-8")).get("sports") or {}
        if block.get("enabled") is True:
            out += [(town, f"{s['adapter']}:{s.get('program', '*')}") for s in block.get("sources", [])]
    return out


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
    if "weather" in only:
        for town in WEATHER_TOWNS:
            row = conn.execute("SELECT payload->>'fetched_at' FROM weather_snapshots WHERE town_id = %s ORDER BY observed_for DESC LIMIT 1", (town,)).fetchone()
            judge("weather", town, "weather", _parse_ts(row[0]) if row else None)
    for kind, towns in (("alerts", ALERT_TOWNS), ("safety", SAFETY_TOWNS)):
        if kind in only:
            for town in towns:
                row = conn.execute("SELECT last_ok FROM dispatcher_heartbeat WHERE town_id = %s AND job = %s", (town, kind)).fetchone()
                judge(kind, town, kind, row[0] if row else None)
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
