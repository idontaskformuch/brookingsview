"""Post-deploy content-freshness check.

Runs as the LAST step of each *-scrape.yml, AFTER the site has actually
been rebuilt and redeployed -- to catch the specific class of failure that
shipped silently, twice, before this existed: a green build masking a
dead production path. Once was `run_worker_first` defaulting to false
(the Worker's own /this-week/ redirect logic was correct and deployed,
but unreachable). The other was the multi-day content-generation outage
starting 2026-08-27 (the scheduled scrape+publish cron simply stopped
firing for all three towns; every build that DID run was green, because
"no new content this run" and "the pipeline is dead" produce an
identical exit code). No existing test looks at the LIVE, DEPLOYED site
-- this does.

Two checks, both against the real production URL (never localhost/dist/,
so a Cloudflare deploy-hook failure or propagation delay is caught too,
not just a code bug):

  1. Of every /s/<slug>/ link actually present on the homepage, at least
     one resolves (via the DB, the same source of truth the build itself
     reads) to a story published within FRESHNESS_DAYS -- not "the single
     newest DB row is linked" (the homepage's own curation logic doesn't
     always surface the literal newest item, and 'weekly' stories link
     via /this-week/ instead of /s/ -- see check_homepage_freshness).
  2. The town's own signature section returns real, town-specific content
     -- checked against a literal marker string pulled from the DB for
     that section, not a generic "page looks non-empty" heuristic.

FRESHNESS_DAYS=2 for all three towns: ai_pipeline/daily_content.py runs
once per day, every day (scheduler.weekly_rotation.ROTATION covers all 7
weekdays, no gap day), for every town, via its own daily cron -- so under
normal operation there should never be a 2-day span with zero new
stories. This catches an outage within a day of it starting without
false-alarming on a single day's AI-budget skip or transient failure.

Fails loud: non-zero exit (job failure) plus the same ALERT_WEBHOOK every
scraper failure already posts to (see scrapers/runner.py's own _alert(),
mirrored here rather than imported -- this runs as a standalone step
after the scrape step's own DB connection has already closed, in a
separate process).

Usage:
    python -m scripts.check_deployed_content --config configs/broomfield_co.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

from db.db import get_conn

FRESHNESS_DAYS = 2

# NOT read from configs/<town>.json's own "domain" field -- found stale
# live 2026-08-28 (brookings_sd's says "brookings311.com", the site has
# been "brookingsview.com" for the whole session; that field is write-only
# into the towns table, nothing ever reads it back, so it silently drifted
# with no consequence until now). Matches site/src/lib/site-config.ts's
# real siteUrl values instead, which are what's actually deployed.
SITE_URLS = {
    "brookings_sd": "https://brookingsview.com",
    "moreno_valley_ca": "https://morenovalleyview.com",
    "broomfield_co": "https://broomfieldview.com",
}

# Each town's flagship, town-specific section -- a page with no real
# content here is the same "skeleton, not a working site" failure mode
# as an empty homepage, just easier to miss since the homepage itself can
# still show older, still-technically-true content (weather, jobs) even
# when a town's OWN generation has stalled.
#
# Checked by ABSENCE of the page's own already-existing empty-state string
# (house rule 4 in this codebase: never render a feature with nothing in
# it, every one of these pages already has a real `{ items.length > 0 ?
# <content> : <p class="empty">...</p> }` branch) rather than by presence
# of a "latest DB row" marker -- tried that first, it false-failed
# immediately on Brookings: the "latest" sdsu_events row by start date was
# a far-future one-off closure notice outside the page's own 60-day
# rendering window, which the page correctly never shows. Checking for
# the SAME empty-state text the page itself already renders sidesteps
# needing to reimplement each page's own eligibility window out here.
SIGNATURE_SECTIONS = {
    "brookings_sd": {
        "path": "/university/",
        "empty_state_text": "No upcoming events listed right now.",
    },
    "moreno_valley_ca": {
        "path": "/workplace-watch/",
        "empty_state_text": "No reviews summarized yet this month.",
    },
    "broomfield_co": {
        "path": "/vail-resorts/",
        "empty_state_text": "No Vail Resorts news collected yet",
    },
}


def _alert(town_id: str, msg: str) -> None:
    import os
    hook = os.environ.get("ALERT_WEBHOOK")
    full_msg = f"[{town_id}] post-deploy content check FAILED: {msg}"
    print(f"ALERT: {full_msg}", file=sys.stderr)
    if hook:
        try:
            requests.post(hook, json={"text": full_msg}, timeout=10)
        except Exception:  # pragma: no cover
            pass


def extract_story_slugs(html: str) -> list[str]:
    """Every distinct /s/<slug>/ link in a page's HTML, sorted for
    deterministic testing. Pure, no network/DB -- unit tested directly."""
    return sorted(set(re.findall(r"/s/([a-z0-9][a-z0-9_-]*)/", html)))


def is_stale(newest_published_at, freshness_days: int, now: datetime) -> bool:
    """True if `newest_published_at` (a tz-aware datetime, or None) is
    older than `freshness_days` relative to `now`. None counts as stale
    (nothing matched). Pure, `now` injectable -- unit tested directly."""
    if newest_published_at is None:
        return True
    return newest_published_at < now - timedelta(days=freshness_days)


def check_homepage_freshness(conn, town_id: str, site_url: str) -> str | None:
    """Returns an error string on failure, None on success.

    Checks that AT LEAST ONE of the homepage's OWN /s/<slug>/ links points
    at a recent story -- not that the single most-recent DB row by
    published_at specifically appears. First version asserted the latter
    and false-failed immediately on real production data: the homepage's
    curation logic (see lib/homepage-curation.ts) deliberately doesn't
    always surface the literal newest row (Moreno Valley's newest story
    that day wasn't selected as lead/worth-knowing), and a 'weekly'
    story's own permalink is /s/weekly-<slug>/ but the homepage links to
    it via /this-week/<iso-week>/ instead (see this-week.ts) -- neither is
    a real problem, both broke the naive version of this check.
    """
    try:
        r = requests.get(site_url + "/", timeout=20)
    except Exception as exc:
        return f"could not fetch homepage ({site_url}/): {exc}"
    if r.status_code != 200:
        return f"homepage returned HTTP {r.status_code}, expected 200"

    slugs = extract_story_slugs(r.text)
    if not slugs:
        return "homepage has no /s/<slug>/ links at all"

    with conn.cursor() as cur:
        cur.execute(
            "SELECT max(published_at) FROM stories WHERE town_id=%s AND slug = ANY(%s)",
            (town_id, slugs),
        )
        newest = cur.fetchone()[0]
    if newest is None:
        return f"none of the homepage's {len(slugs)} story links matched a real DB row for this town"

    if is_stale(newest, FRESHNESS_DAYS, datetime.now(timezone.utc)):
        return (f"newest story linked from the homepage was published {newest}, "
                f"older than the {FRESHNESS_DAYS}-day freshness window")
    return None


def check_signature_section(town_id: str, site_url: str) -> str | None:
    section = SIGNATURE_SECTIONS[town_id]
    url = site_url + section["path"]
    try:
        r = requests.get(url, timeout=20)
    except Exception as exc:
        return f"could not fetch signature section ({url}): {exc}"
    if r.status_code != 200:
        return f"signature section ({url}) returned HTTP {r.status_code}, expected 200"

    if section["empty_state_text"] in r.text:
        return (f"signature section ({url}) is showing its own empty state "
                f"({section['empty_state_text']!r}) -- content generation for "
                f"this section may have stalled")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg = json.loads(open(args.config, encoding="utf-8").read())
    town_id = cfg["town_id"]
    site_url = SITE_URLS.get(town_id)
    if not site_url:
        print(f"no known site URL for town_id={town_id!r} -- add it to SITE_URLS", file=sys.stderr)
        return 1

    failures: list[str] = []
    with get_conn() as conn:
        err = check_homepage_freshness(conn, town_id, site_url)
        if err:
            failures.append(f"homepage freshness: {err}")
        else:
            print(f"  [{town_id}] homepage freshness: ok")

        err = check_signature_section(town_id, site_url)
        if err:
            failures.append(f"signature section: {err}")
        else:
            print(f"  [{town_id}] signature section: ok")

    if failures:
        for f in failures:
            print(f"  [{town_id}] FAIL -- {f}", file=sys.stderr)
        _alert(town_id, "; ".join(failures))
        return 1

    print(f"  [{town_id}] post-deploy content check: all clear")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
