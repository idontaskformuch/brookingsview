"""Daily watch: is broomfield.org's event calendar (iCal) still closed to us by robots.txt? (owner order 2026-11-25/26)

Since 2026-10-21 broomfield.org/robots.txt disallows /common/modules/icalendar/ for User-agent *, so Broomfield's four city calendar
feeds (configs/broomfield_co.json, events sources with a /common/modules/iCalendar/ URL) are never fetched. This script reads ONLY
robots.txt (PoliteFetcher.robots_verdict: one robots.txt request, the feeds themselves are never requested) and asks, for each feed URL,
whether our one UA (ViewMediaBot) may fetch it now.

  * every feed still disallowed            -> nothing; a still-open issue gets its "clean run" comment and closes after 2
  * one or more feeds allowed again        -> ONE problem: an alert via scrapers/alert_state.py (new / daily reminder / resolved) and
                                              ONE GitHub issue via qa/report.py (check ops.robots-unblocked). The owner then decides
                                              whether the feeds are read again; nothing is switched on here.
  * robots.txt unreadable (no answer, 5xx, 403) -> neither: an unreadable file says nothing about the rules (printed, exit 0)

    python -m scripts.watch_robots_unblock            # what .github/workflows/robots-watch.yml runs (alert + issue)
    python -m scripts.watch_robots_unblock --dry-run  # read robots.txt and print the verdicts; no DB, no alert, no issue
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK_ID = "ops.robots-unblocked"
TOWN = "broomfield_co"
PATTERN = "broomfield-ical"
SCOPE = "robots-unblock|"
ICAL_PATH = "/common/modules/icalendar/"


def ical_urls(config_path: Path = ROOT / "configs" / f"{TOWN}.json") -> list[str]:
    """The calendar feed URLs from the town config (every events source whose URL is under /common/modules/iCalendar/)."""
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    out: list[str] = []

    def walk(o) -> None:
        if isinstance(o, dict):
            url = o.get("url")
            if isinstance(url, str) and ICAL_PATH in url.lower() and url not in out:
                out.append(url)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(cfg.get("sources", cfg))
    return out


def findings(status: int | None, verdicts: dict[str, bool]) -> list[dict]:
    """One finding when robots.txt was read (200/404) and at least one feed URL is allowed; [] otherwise. Pure, tested without network."""
    if status not in (200, 404):
        return []
    allowed = [u for u, ok in verdicts.items() if ok]
    if not allowed:
        return []
    return [{"check": CHECK_ID, "town": TOWN, "pattern": PATTERN, "path": f"/{TOWN}/{PATTERN}",
             "message": f"broomfield.org/robots.txt no longer blocks {len(allowed)} of {len(verdicts)} calendar feed(s) for ViewMediaBot: "
                        + ", ".join(allowed) + ". Nothing was fetched or switched on; the owner decides whether the feeds are read again "
                        "(configs/broomfield_co.json, the ROBOTS-BLOCKED notes)."}]


def _lower_path(url: str) -> str:
    from urllib.parse import urlsplit, urlunsplit
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, p.path.lower(), p.query, p.fragment))


def check(fetcher) -> tuple[int | None, dict[str, bool]]:
    """A feed counts as allowed only when neither its URL nor the same URL with a lower-case path is disallowed. The rule is written
    "Disallow: /common/modules/icalendar/" while the feeds live under /common/modules/iCalendar/: RFC 9309 matches paths case-sensitively,
    so the parser alone says "allowed", yet the site plainly means the calendar (it lists every other path in both cases, and the owner
    treats the feeds as blocked since 2026-11-04). Only the rule's removal opens the issue."""
    urls = ical_urls()
    verdicts = {u: fetcher.robots_verdict(u).ok and fetcher.robots_verdict(_lower_path(u)).ok for u in urls}
    status, _ = fetcher.robots_text(urls[0]) if urls else (None, "")
    return status, verdicts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    from scrapers.polite_fetch import PoliteFetcher
    status, verdicts = check(PoliteFetcher("evidence", TOWN))
    print(f"[robots-watch] broomfield.org/robots.txt answered {status}")
    for u, ok in verdicts.items():
        print(f"  {'ALLOWED' if ok else 'blocked'}  {u}")
    found = findings(status, verdicts)
    if status not in (200, 404):
        print("[robots-watch] robots.txt unreadable: no verdict, no alert, no issue change")
        return 0
    if args.dry_run:
        print(f"[robots-watch] dry run: {len(found)} finding(s); nothing sent")
        return 0
    from db.db import get_conn
    from qa.report import report
    from scrapers.alert_state import reconcile
    from scrapers.alerts import send_alert
    title = "[broomfield_co] calendar feeds allowed by robots.txt again"
    active = {f"{SCOPE}{TOWN}": f["message"] for f in found}
    with get_conn() as conn:
        if reconcile(conn, SCOPE, active, title=title) is None and found:
            send_alert(found[0]["message"], title=title)
    repo, run = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    try:  # always called, so a still-open issue gets its clean-run comments and closes once the feeds are blocked again
        report(found, report_only=False, scope_towns={TOWN}, clean_to_close=2,
               run_url=f"https://github.com/{repo}/actions/runs/{run}" if repo and run else "", scope_checks=lambda c: c == CHECK_ID)
    except Exception as exc:  # pragma: no cover -- GitHub's API must not hide the result printed above
        print(f"[robots-watch] issue reporting failed: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
