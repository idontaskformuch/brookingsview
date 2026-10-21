"""Watchdog: fails loudly if no scrape has succeeded for a town in MAX_HOURS.

Why (2026-10-21, .claude/state.md Kö 9): scrape + closure-watch scheduling
moves from GitHub's own `schedule:` (4.5-9.5 h late) to a Cloudflare Worker
(cron-dispatcher/) that calls workflow_dispatch. If that Worker, its GitHub
token (90-day expiry) or the dispatch itself breaks, nothing would run and
nothing would complain -- source-staleness-check only notices after DAYS
(events: 2 d). This check is deliberately NOT dispatched by the Worker: it
runs on GitHub's own schedule (.github/workflows/scrape-liveness-check.yml)
so a dead Worker cannot also silence its own alarm. A red X on that workflow
IS the alert, plus a GitHub issue per stale town (qa/report.py; GitHub's own
notification mail delivers it -- no ALERT_WEBHOOK needed; ALERT_WEBHOOK is still
honoured if set). The issue closes itself after 2 clean runs in a row.

"Succeeded" = at least one scrape_runs row with status='ok' for the town
whose started_at is within MAX_HOURS. 18 h = three missed 6-hourly slots.

Usage:
    python -m scripts.check_scrape_liveness brookings_sd moreno_valley_ca broomfield_co
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from db.db import get_conn
from qa.report import report

MAX_HOURS = 18


def is_stale(last_ok: datetime | None, now: datetime, max_hours: float = MAX_HOURS) -> bool:
    """True when there is no successful run, or the newest one is older than
    max_hours. Pure so it can be tested without a DB."""
    if last_ok is None:
        return True
    return now - last_ok > timedelta(hours=max_hours)


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
    ap.add_argument("towns", nargs="+", help="town_id values, e.g. brookings_sd")
    ap.add_argument("--max-hours", type=float, default=MAX_HOURS)
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    stale: list[str] = []
    findings: list[dict] = []
    with get_conn() as conn:
        for town in args.towns:
            row = conn.execute(
                "SELECT max(started_at) FROM scrape_runs WHERE town_id = %s AND status = 'ok'",
                (town,),
            ).fetchone()
            last_ok = row[0] if row else None
            if is_stale(last_ok, now, args.max_hours):
                age = "never" if last_ok is None else f"{(now - last_ok).total_seconds() / 3600:.1f} h ago"
                stale.append(f"[{town}] last successful scrape: {age} (limit {args.max_hours:g} h)")
                findings.append({"check": "ops.scrape-liveness", "town": town, "pattern": town, "path": f"/{town}",
                                 "message": f"last successful scrape: {age} (limit {args.max_hours:g} h). "
                                            "Check the Cloudflare cron-dispatcher Worker and its GITHUB_TOKEN expiry."})
                print(f"  [liveness] {town}: STALE -- {age}")
            else:
                print(f"  [liveness] {town}: ok -- {(now - last_ok).total_seconds() / 3600:.1f} h ago")
    try:  # always called (also with no findings) so a fixed town's issue can close itself
        report(findings, report_only=False, scope_towns=set(args.towns), clean_to_close=2,
               run_url=_run_url())
    except Exception as exc:  # pragma: no cover -- the red X below must never depend on GitHub's API
        print(f"  [liveness] issue reporting failed: {exc}", file=sys.stderr)
    if stale:
        _alert("No recent successful scrape:\n  " + "\n  ".join(stale)
               + "\nCheck the Cloudflare cron-dispatcher Worker and its GITHUB_TOKEN expiry.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
