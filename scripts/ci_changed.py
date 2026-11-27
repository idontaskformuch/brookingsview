"""Did a CI step change what the site shows? Decides whether a workflow needs to build and deploy.

Actions minutes are the budget (private repo, .claude/specs/actions-minutes-plan.md). A scrape or a nightly digest that
changed nothing must not cost a 5-20 minute build. This fingerprints, per town, the rows that end up on the pages and
compares before/after a step:

    python -m scripts.ci_changed before <town_id> [--preset content|data]     # writes .ci_fingerprint
    python -m scripts.ci_changed after  <town_id> [--preset content|data]     # prints changed=true|false, and to $GITHUB_OUTPUT

Presets
  content  the AI-written text of digests/roundups/intros (stories, whats_on_intro, event_deck_digest, closure_watch_prose)
  data     content + everything scrapers write that a page shows (events, meetings, jobs, sales, school alerts, sports ...)
Never counted: traffic_incidents, weather_snapshots, scrape_runs, source_snapshots, api_usage, ai_crawler_hits, logs, and the
warning rows (events.source nws_alert / met_office_warning, written every 15 minutes by the cron-dispatcher Worker and read
through /api/ in the browser). Traffic and weather change on every scrape; counting them would build every time. The forecast on
a page is only as fresh as the last build: the 11:00 and 23:00 UTC scrape runs, or a push (the daily-content workflows were removed 2026-11-07).

The first run after local midnight always builds (owner 2026-11-27): `after` reads the live homepage's <meta name="data-built-at"> the
way check_deployed_content.py reads the deployed site, and a build on an earlier date in the town's own timezone (configs/<town>.json)
means changed=true, so dates on the pages roll over. A failed read or a missing tag also means changed=true (fail open).

Volatile columns are stripped from the row before hashing (ids, created/updated/seen timestamps, snapshot_id). If anything
fails (no database, a table is missing) the answer is changed=true: a wasted build is cheaper than a stale site. When the answer
is true, the log names the tables that differed, so a step that rewrites rows on every run is easy to find.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from scripts.check_deployed_content import _request_headers, extract_built_at
from scrapers.user_agent import SITE_DOMAINS

ROOT = Path(__file__).resolve().parent.parent

CONTENT_TABLES = ["stories", "whats_on_intro", "event_deck_digest", "closure_watch_prose"]
DATA_TABLES = CONTENT_TABLES + [
    "events", "meetings", "jobs", "property_sales", "school_alerts", "sdsu_events", "regional_sports_games",
    "vail_news", "projects", "places", "ag_prices", "academic_calendar_dates", "employer_job_stats",
    "sport_events",
    # 2026-11-20: the first good restrictions run (13:37 UTC) wrote 2 rows and printed changed=false, so /safety/ kept "Not checked
    # yet". An append log: every run adds a row, so each check (twice a day) rebuilds Broomfield and moves "Last checked".
    "restriction_checks",
]
PRESETS = {"content": CONTENT_TABLES, "data": DATA_TABLES}
VOLATILE = ["id", "snapshot_id", "created_at", "updated_at", "first_seen_at", "last_seen_at", "fetched_at", "scraped_at", "checked_at", "last_seen", "missed_runs"]
# Warnings are written every 15 minutes by the cron-dispatcher Worker and read through /api/ in the browser; they never cause a build.
EXTRA_WHERE = {"events": " AND source NOT IN ('nws_alert', 'met_office_warning')"}
FILE = Path(".ci_fingerprint")


def table_sql(table: str) -> str:
    """One digest per table for the town: order-independent hash of the rows minus the volatile columns."""
    drop = " ".join(f"- '{c}'" for c in VOLATILE)
    return (f"SELECT COALESCE(md5(string_agg(md5((to_jsonb(x) {drop})::text), '' ORDER BY md5((to_jsonb(x) {drop})::text))), '') "
            f"FROM {table} x WHERE town_id = %s{EXTRA_WHERE.get(table, '')}")


def table_hashes(conn, town: str, tables: list[str]) -> dict[str, str]:
    out = {}
    with conn.cursor() as cur:
        for t in tables:
            cur.execute(table_sql(t), (town,))
            out[t] = cur.fetchone()[0]
    return out


def fingerprint(hashes: dict[str, str]) -> str:
    return hashlib.sha256("\n".join(f"{t}={h}" for t, h in sorted(hashes.items())).encode()).hexdigest()


def changed_tables(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(t for t in after if before.get(t) != after[t])


def decide(before: str | None, after: str | None, built_today: bool = True) -> bool:
    """True = rebuild. Any missing side (error) means rebuild; so does a live site built on an earlier local day (built_today False)."""
    return not built_today or not before or not after or before != after


def town_timezone(town: str) -> str:
    return json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))["timezone"]


def live_homepage(town: str) -> str | None:
    """The live homepage's HTML, read the way scripts/check_deployed_content.py reads the deployed site (ViewMediaBot + the named
    DEPLOY_CHECK_SECRET header Cloudflare lets through from GitHub's runners). None on any failure: the caller then builds."""
    site_url = f"https://{SITE_DOMAINS[town]}"
    try:
        r = requests.get(site_url + "/", timeout=20, headers=_request_headers(site_url))
    except Exception as exc:  # noqa: BLE001 -- fail open: build
        print(f"live homepage not read ({exc.__class__.__name__}: {exc}); treating as not built today", file=sys.stderr)
        return None
    if r.status_code != 200:
        print(f"live homepage answered HTTP {r.status_code}; treating as not built today", file=sys.stderr)
        return None
    return r.text


def built_today(html: str | None, tzname: str, now: datetime) -> bool:
    """True when the page's <meta name="data-built-at"> falls on today's date in the town's own timezone (owner 2026-11-27: the first
    run after local midnight always builds, so dates on the pages roll over). No page, no tag or an unreadable time = False (build)."""
    built = extract_built_at(html) if html else None
    if built is None:
        return False
    tz = ZoneInfo(tzname)
    return built.astimezone(tz).date() == now.astimezone(tz).date()


def _emit(changed: bool) -> None:
    line = f"changed={'true' if changed else 'false'}"
    print(line)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def _read_before() -> dict[str, str] | None:
    try:
        text = FILE.read_text(encoding="utf-8").strip() if FILE.exists() else ""
        return json.loads(text) if text else None
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("phase", choices=["before", "after"])
    ap.add_argument("town")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="data")
    args = ap.parse_args()
    try:
        from db.db import get_conn
        with get_conn() as conn:
            hashes = table_hashes(conn, args.town, PRESETS[args.preset])
    except Exception as exc:  # noqa: BLE001 -- fail open: build
        print(f"fingerprint failed ({exc}); treating as changed", file=sys.stderr)
        hashes = None
    if args.phase == "before":
        FILE.write_text(json.dumps(hashes) if hashes else "", encoding="utf-8")
        return 0
    before = _read_before()
    try:
        tzname = town_timezone(args.town)
        today = built_today(live_homepage(args.town), tzname, datetime.now(timezone.utc))
    except Exception as exc:  # noqa: BLE001 -- fail open: build
        print(f"build-date check failed ({exc}); treating as not built today", file=sys.stderr)
        today = False
    if not today:
        print("live site not built today (local date) -- rebuilding")
    changed = decide(fingerprint(before) if before else None, fingerprint(hashes) if hashes else None, built_today=today)
    if changed and before and hashes:
        print("tables that changed: " + (", ".join(changed_tables(before, hashes)) or "(none)"))
    _emit(changed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
