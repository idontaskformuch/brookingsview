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

  1. Of every /s/<slug>/ AND /this-week/<week>/ link actually present on
     the homepage, at least one resolves (via the DB, the same source of
     truth the build itself reads) to a story published within
     DEFAULT_FRESHNESS_DAYS (or a town's own `freshness_check_days`
     config override) -- not "the single newest DB row is linked" (the
     homepage's own curation logic doesn't always surface the literal
     newest item -- see check_homepage_freshness).
  2. The town's own signature section returns real, town-specific content
     -- checked against a literal marker string pulled from the DB for
     that section, not a generic "page looks non-empty" heuristic.

DEFAULT_FRESHNESS_DAYS=8 (overridable per town via configs/<town>.json's
`freshness_check_days`): today's actual cadence has no single guaranteed-
daily publish. The generic AI content track (editorials/columns/reviews/
recipes) that used to publish one new, homepage-linked story every day --
the assumption an earlier FRESHNESS_DAYS=2 relied on -- was switched off
config-wide in scheduler/weekly_rotation.py as of the 2026-10-07 AdSense
remediation (Phase 0) and is no longer linked from the homepage at all.
What's left (meeting/event scrapers, the weekly roundup) runs on its own
schedule and genuinely can go several days with nothing new for a given
town -- confirmed live on Broomfield (2026-10-13): zero new /s/-linkable
stories for 11 days straight, a real gap FRESHNESS_DAYS=2 could never
have tolerated even on a perfectly healthy pipeline. 8 days comfortably
covers the weekly roundup's own 7-day cycle (now counted towards
freshness too, via its /this-week/ link -- see check_homepage_freshness)
plus a day of slack, while still catching a real multi-day outage.

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
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

from ai_pipeline.daily_content import SLUG_PREFIX_OVERRIDES
from db.db import get_conn

# Reverse of SLUG_PREFIX_OVERRIDES (content_type -> public prefix), keyed by
# the PUBLIC prefix instead, for matching a homepage-scraped /s/<slug>/ href
# back to the DB's own slug prefix. Bug found 2026-10-02 (broomfield-deploy
# failing its freshness check): this function originally compared scraped
# hrefs against stories.slug DIRECTLY, which worked until 8a0a938 ("English
# slugs for new content") made the public URL prefix diverge from the DB
# slug column for these four content types -- every homepage link to one of
# them could then never match a real row, however fresh, making this check
# permanently fail for any town publishing them (exactly the failure mode
# this script exists to catch, except the bug was in the checker itself).
PUBLIC_PREFIX_TO_DB: dict[str, str] = {public: db for db, public in SLUG_PREFIX_OVERRIDES.items()}

# Anchored at the start of the slug, prefix being one of PUBLIC_PREFIX_TO_DB's
# keys -- NOT a naive split on the first "-", which would wrongly cut
# "science-column-2026-10-02" into "science"/"column-..." (two of the four
# public prefixes -- "science-column", "quick-essay" -- contain their own
# internal hyphen). Longest-prefix-first so "quick-essay" can never be
# mis-matched by a shorter prefix that happens to also start matching.
_PUBLIC_PREFIX_RE = re.compile(
    "^(" + "|".join(re.escape(p) for p in sorted(PUBLIC_PREFIX_TO_DB, key=len, reverse=True)) + ")-"
)


def resolve_homepage_slugs_to_db_slugs(homepage_slugs: list[str]) -> list[str]:
    """Maps each homepage-scraped /s/<slug>/ value back to the slug it would
    actually be stored under in stories.slug -- a pure inverse of site/src/
    lib/content-slugs.ts's publicSlug(), kept in sync via SLUG_PREFIX_
    OVERRIDES (the same dict daily_content.py uses to build the public
    prefix in the first place) rather than a second hand-maintained mapping.
    A slug with no recognized public prefix (every content type other than
    the renamed four, e.g. "meeting-...", "event-...") passes through
    unchanged, same as content-slugs.ts's own no-op case."""
    out = []
    for slug in homepage_slugs:
        match = _PUBLIC_PREFIX_RE.match(slug)
        if match is None:
            out.append(slug)
            continue
        db_prefix = PUBLIC_PREFIX_TO_DB[match.group(1)]
        out.append(db_prefix + slug[match.end(1):])
    return out

DEFAULT_FRESHNESS_DAYS = 8

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


def _user_agent(site_url: str) -> str:
    """A real, identifying User-Agent -- not a spoofed browser string, and
    not `requests`' own default ("python-requests/X.Y.Z"), which is what
    this checker sent before this fix. Confirmed live (2026-09-08):
    Cloudflare's bot protection on broomfieldview.com's zone specifically
    blocked that default, returning HTTP 403 to this checker while a real
    browser and other clients got 200 with fresh content -- Brookings and
    Moreno Valley's zones never had the problem, which is why this went
    unnoticed until Broomfield existed. Matches the SAME
    "<domain> (contact: hello@<domain>)" convention every scrape workflow's
    own USER_AGENT already uses (see e.g. broomfield-scrape.yml) rather than
    inventing a second convention -- derived from SITE_URLS itself so the
    two can never drift apart the way the (now-removed) hardcoded domain
    field in configs/*.json once did (see this file's own comment above)."""
    domain = site_url.removeprefix("https://").removeprefix("http://")
    return f"{domain} (contact: hello@{domain})"


# Broomfield 403 investigation (2026-09-09): the User-Agent fix above did NOT
# resolve it -- confirmed via real GitHub Actions run history (every run
# since that fix failed at this exact step, 4/4, while the identical request
# succeeds every time from outside GitHub's runner IP ranges regardless of
# User-Agent). That's the signature of Cloudflare's bot-management scoring
# GitHub Actions' shared datacenter IPs as automated traffic, not a
# User-Agent block -- an IP-based Cloudflare rule can't be worked around from
# this side with a header alone, so this is deliberately a NAMED bypass, not
# a disguise: a Cloudflare WAF Custom Rule (configured separately, see the
# rollout notes accompanying this change) skips bot-management specifically
# for requests carrying this exact header+secret pair, verifying the request
# really is this checker before letting it through -- the same shape as any
# authenticated health-check bypass. Optional and additive: DEPLOY_CHECK_SECRET
# unset (a town with no matching Cloudflare rule yet) means no header is
# sent at all, identical to this script's behavior before this change.
DEPLOY_CHECK_HEADER = "X-BV-Deploy-Check"


def _request_headers(site_url: str) -> dict[str, str]:
    headers = {"User-Agent": _user_agent(site_url)}
    secret = os.environ.get("DEPLOY_CHECK_SECRET")
    if secret:
        headers[DEPLOY_CHECK_HEADER] = secret
    return headers

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


def extract_weekly_slugs(html: str) -> list[str]:
    """Every distinct /this-week/<iso-week>/ link in a page's HTML, mapped
    directly to the stories.slug it backs ('weekly-<iso-week>' -- see
    ai_pipeline's weekly-roundup generator and site/src/pages/this-week/
    [week].astro, the same convention lib/homepage-curation.ts's
    getLatestWeekly() callers build that href from). A separate function
    from extract_story_slugs() because this is a different URL path
    (/this-week/, not /s/), not one of SLUG_PREFIX_OVERRIDES's renamed
    /s/ prefixes -- see resolve_homepage_slugs_to_db_slugs() for those.
    Pure, no network/DB -- unit tested directly."""
    weeks = sorted(set(re.findall(r"/this-week/([0-9]{4}-w[0-9]{2})/", html)))
    return [f"weekly-{week}" for week in weeks]


def is_stale(newest_published_at, freshness_days: int, now: datetime) -> bool:
    """True if `newest_published_at` (a tz-aware datetime, or None) is
    older than `freshness_days` relative to `now`. None counts as stale
    (nothing matched). Pure, `now` injectable -- unit tested directly."""
    if newest_published_at is None:
        return True
    return newest_published_at < now - timedelta(days=freshness_days)


def check_homepage_freshness(
    conn,
    town_id: str,
    site_url: str,
    freshness_days: int = DEFAULT_FRESHNESS_DAYS,
    reference_now: datetime | None = None,
) -> tuple[str, bool] | None:
    """Returns (error, is_transient) on failure, None on success.
    `is_transient` is True for a fetch/DB blip a retry might resolve
    (network error, non-200 status), False for a genuine content problem
    (nothing linked, or nothing linked is fresh) that waiting a few more
    minutes can never fix -- see run_with_retry's own docstring for how
    that flag is used to decide whether to retry at all.

    Checks that AT LEAST ONE of the homepage's OWN /s/<slug>/ OR
    /this-week/<week>/ links points at a recent story -- not that the
    single most-recent DB row by published_at specifically appears. First
    version asserted the latter and false-failed immediately on real
    production data: the homepage's curation logic (see lib/homepage-
    curation.ts) deliberately doesn't always surface the literal newest
    row (Moreno Valley's newest story that day wasn't selected as lead/
    worth-knowing). /this-week/<week>/ links count towards freshness too
    (added 2026-10-13, see the module docstring's DEFAULT_FRESHNESS_DAYS
    paragraph) -- excluding the weekly roundup entirely was itself part of
    why Broomfield's homepage had nothing fresh left to point at once the
    generic AI content track was switched off.
    """
    try:
        r = requests.get(site_url + "/", timeout=20, headers=_request_headers(site_url))
    except Exception as exc:
        return f"could not fetch homepage ({site_url}/): {exc}", True
    if r.status_code != 200:
        return f"homepage returned HTTP {r.status_code}, expected 200", True

    slugs = extract_story_slugs(r.text)
    weekly_db_slugs = extract_weekly_slugs(r.text)
    if not slugs and not weekly_db_slugs:
        # Transient, not a genuine freshness failure: a homepage that
        # renders with ZERO story/weekly links at all is indistinguishable
        # from the same propagation lag RETRY_TIMEOUT_SECONDS exists for
        # (a page mid-deploy can legitimately come back incomplete) --
        # unlike "links exist but are stale/unmatched" below, there's
        # nothing here to conclude is a real, settled content problem yet.
        return "homepage has no /s/<slug>/ or /this-week/<week>/ links at all", True

    # Bug fix 2026-10-02: homepage hrefs are PUBLIC slugs (site/src/lib/
    # content-slugs.ts's publicSlug()), which diverge from stories.slug for
    # four content types since 8a0a938 ("English slugs for new content") --
    # comparing the raw scraped slugs against the DB column directly made
    # this check permanently unable to match any of those four types,
    # however recently published (see resolve_homepage_slugs_to_db_slugs()'s
    # own docstring for the live case this was caught on: broomfield_co's
    # genuinely-fresh media_recension-2026-09-30 / public "review-2026-09-30"
    # story, live and 200-ing, that this check reported as 29-day-stale).
    db_slugs = resolve_homepage_slugs_to_db_slugs(slugs) + weekly_db_slugs

    with conn.cursor() as cur:
        cur.execute(
            "SELECT max(published_at) FROM stories WHERE town_id=%s AND slug = ANY(%s)",
            (town_id, db_slugs),
        )
        newest = cur.fetchone()[0]
    if newest is None:
        return (
            f"none of the homepage's {len(slugs) + len(weekly_db_slugs)} story/weekly "
            f"links matched a real DB row for this town"
        ), False

    now = reference_now if reference_now is not None else datetime.now(timezone.utc)
    if is_stale(newest, freshness_days, now):
        return (
            f"newest story linked from the homepage was published {newest}, "
            f"older than the {freshness_days}-day freshness window"
        ), False
    return None


def check_signature_section(town_id: str, site_url: str) -> str | None:
    section = SIGNATURE_SECTIONS[town_id]
    url = site_url + section["path"]
    try:
        r = requests.get(url, timeout=20, headers=_request_headers(site_url))
    except Exception as exc:
        return f"could not fetch signature section ({url}): {exc}"
    if r.status_code != 200:
        return f"signature section ({url}) returned HTTP {r.status_code}, expected 200"

    if section["empty_state_text"] in r.text:
        return (f"signature section ({url}) is showing its own empty state "
                f"({section['empty_state_text']!r}) -- content generation for "
                f"this section may have stalled")
    return None


# 2026-10-01: both checks hit the live edge (Cloudflare propagation can lag
# a few seconds to low tens of seconds behind a fresh deploy) and a fresh
# Neon connection (this exact project has hit a transient "fetch failed"
# from Neon's serverless driver before, see the astro build retries this
# same day, and get_conn() here is the identical driver). Neither is a real
# content/deploy problem -- a single failed attempt right after `wrangler
# deploy` finishes is expected often enough that this used to fail the job
# on it. Retrying for a few minutes before giving up tells apart "still
# propagating" from "actually broken" without weakening the check itself:
# a genuinely broken deploy is still broken 5 minutes later and still fails
# loud, same alert as before.
RETRY_TIMEOUT_SECONDS = 300
RETRY_INTERVAL_SECONDS = 20


def _run_checks_once(town_id: str, site_url: str, freshness_days: int) -> tuple[list[str], bool]:
    """One attempt at both checks, each against a FRESH DB connection (not
    reused across retries -- a connection that failed once is exactly the
    kind of thing a retry shouldn't trust again). Returns (failures,
    retryable): failures is the list of failure strings (empty on
    success); retryable is False as soon as any failure is a genuine
    content problem rather than a transient fetch/DB blip (currently only
    check_homepage_freshness can report that -- see its own (message,
    is_transient) return shape), so run_with_retry stops immediately
    instead of burning its retry window on something that will look
    identical five minutes from now."""
    failures: list[str] = []
    retryable = True
    try:
        with get_conn() as conn:
            fresh_err = check_homepage_freshness(conn, town_id, site_url, freshness_days)
            if fresh_err:
                message, transient = fresh_err
                failures.append(f"homepage freshness: {message}")
                if not transient:
                    retryable = False
            else:
                print(f"  [{town_id}] homepage freshness: ok")

            sig_err = check_signature_section(town_id, site_url)
            if sig_err:
                failures.append(f"signature section: {sig_err}")
            else:
                print(f"  [{town_id}] signature section: ok")
    except Exception as exc:  # noqa: BLE001 -- a DB/network exception counts as a failed attempt, not a crash
        failures.append(f"attempt raised {type(exc).__name__}: {exc}")
    return failures, retryable


def run_with_retry(
    check_fn,
    town_id: str,
    timeout_seconds: float = RETRY_TIMEOUT_SECONDS,
    interval_seconds: float = RETRY_INTERVAL_SECONDS,
    sleep_fn=time.sleep,
    clock_fn=time.monotonic,
) -> list[str]:
    """Calls check_fn() (no args, returns (failures, retryable) -- failures
    is a list of failure strings, empty on success) repeatedly until it
    succeeds, timeout_seconds has elapsed, or an attempt comes back with
    retryable=False. Returns the LAST attempt's failure list (empty =
    success).

    retryable distinguishes a transient fetch/Neon blip (worth waiting out
    -- see this module's own RETRY_TIMEOUT_SECONDS comment for the original
    propagation-delay case this loop exists for) from a genuine content
    problem such as homepage freshness (see check_homepage_freshness's
    (message, is_transient) return shape): content that's stale right now
    will still be exactly as stale 20 seconds, or 5 minutes, from now, so
    retrying it only burns CI time without ever changing the outcome --
    added 2026-10-13 after the Broomfield freshness outage spent its full
    5-minute retry budget, 16 attempts, on a failure no retry could ever
    have fixed.

    check_fn/sleep_fn/clock_fn are injectable so this loop's own timing and
    give-up logic can be unit tested without a real clock or real I/O (see
    tests/test_check_deployed_content.py) -- same dependency-injection
    shape as server/ticketmaster-image.ts's cacheStorage parameter."""
    start = clock_fn()
    attempt = 0
    failures: list[str] = []
    while True:
        attempt += 1
        failures, retryable = check_fn()
        if not failures:
            print(f"  [{town_id}] post-deploy content check: all clear (attempt {attempt})")
            return failures

        elapsed = clock_fn() - start
        remaining = timeout_seconds - elapsed
        for f in failures:
            print(f"  [{town_id}] attempt {attempt} failed ({elapsed:.0f}s elapsed) -- {f}", file=sys.stderr)
        if not retryable:
            print(f"  [{town_id}] non-transient failure -- not retrying", file=sys.stderr)
            return failures
        if remaining <= 0:
            return failures
        sleep_for = min(interval_seconds, remaining)
        print(f"  [{town_id}] retrying in {sleep_for:.0f}s ({remaining:.0f}s left in the retry window)...")
        sleep_fn(sleep_for)


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
    freshness_days = cfg.get("freshness_check_days", DEFAULT_FRESHNESS_DAYS)

    failures = run_with_retry(lambda: _run_checks_once(town_id, site_url, freshness_days), town_id)
    if failures:
        for f in failures:
            print(f"  [{town_id}] FAIL -- {f}", file=sys.stderr)
        _alert(town_id, "; ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
