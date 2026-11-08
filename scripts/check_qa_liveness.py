"""Watchdog for the daily QA sweep: opens a GitHub issue if qa-daily has not finished green for MAX_HOURS.

Why (2026-10-28): qa/web/run.mjs had a syntax error from 2026-10-24 and nothing noticed -- a broken QA run is silent.
Same pattern as scripts/check_scrape_liveness.py: runs on GitHub's own schedule (.github/workflows/qa-liveness-check.yml),
not dispatched by anything of ours, files one issue through qa/report.py and closes it after 2 clean runs. A red X on the
workflow is the second alarm. qa-daily runs once a day (06:23 UTC); 30 h tolerates GitHub's late schedule plus one slip.

"Green" = the newest qa-daily run whose conclusion is success (all three town jobs passed).

Usage:
    python -m scripts.check_qa_liveness
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import requests

from qa.report import report

MAX_HOURS = 30
WORKFLOW = "qa-daily.yml"


def latest_success(payload: dict) -> datetime | None:
    """Completion time of the newest successful run in a GitHub 'list workflow runs' response (updated_at), or None."""
    times = [r.get("updated_at") for r in payload.get("workflow_runs", []) if r.get("conclusion") == "success" and r.get("updated_at")]
    if not times:
        return None
    return max(datetime.fromisoformat(t.replace("Z", "+00:00")) for t in times)


def is_stale(last_ok: datetime | None, now: datetime, max_hours: float = MAX_HOURS) -> bool:
    """No green run at all, or the newest is older than max_hours. Pure, tested without GitHub."""
    return last_ok is None or now - last_ok > timedelta(hours=max_hours)


def _run_url() -> str:
    repo, run = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    return f"https://github.com/{repo}/actions/runs/{run}" if repo and run else ""


def main() -> int:
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not (token and repo):
        print("GITHUB_TOKEN/GITHUB_REPOSITORY missing", file=sys.stderr)
        return 2
    r = requests.get(
        f"https://api.github.com/repos/{repo}/actions/workflows/{WORKFLOW}/runs",
        params={"status": "success", "per_page": 5},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        timeout=30,
    )
    r.raise_for_status()
    now = datetime.now(timezone.utc)
    last_ok = latest_success(r.json())
    stale = is_stale(last_ok, now)
    findings = []
    if stale:
        age = "never" if last_ok is None else f"{(now - last_ok).total_seconds() / 3600:.1f} h ago"
        findings.append({"check": "ops.qa-liveness", "town": "qa", "pattern": WORKFLOW, "path": f"/{WORKFLOW}",
                         "message": f"{WORKFLOW} last finished green: {age} (limit {MAX_HOURS} h). Open the workflow's runs: "
                                    "a red run, a syntax error in qa/web/*.mjs, or the schedule not firing."})
        print(f"  [qa-liveness] STALE -- {age}")
    else:
        print(f"  [qa-liveness] ok -- {(now - last_ok).total_seconds() / 3600:.1f} h ago")
    try:  # always called so a fixed state closes its own issue
        report(findings, report_only=False, scope_towns={"qa"}, clean_to_close=2, run_url=_run_url(),
               scope_checks=lambda c: c == "ops.qa-liveness")
    except Exception as exc:  # pragma: no cover -- the red X below must not depend on the issue API
        print(f"  [qa-liveness] issue reporting failed: {exc}", file=sys.stderr)
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
