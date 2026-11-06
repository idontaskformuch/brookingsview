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

Three checks, all against the real production URL (never localhost/dist/,
so a Cloudflare deploy-hook failure or propagation delay is caught too,
not just a code bug):

  1. The live homepage carries THIS deploy's build-sha (<meta name=
     "build-sha">, set from GITHUB_SHA) -- proves the edge serves this
     deploy and not a stale cached one.
  2. The homepage's <meta name="data-built-at"> (ISO time of the build,
     BaseLayout.astro) is newer than DEFAULT_BUILT_AT_MAX_HOURS (or a
     town's own `freshness_check_hours` config override). This replaced
     the old "newest /s/<slug>/ or /this-week/<week>/ story linked from the
     homepage is recent" check on 2026-11-06: model-written stories are no
     longer shown (lib/ai-text.ts), so no homepage links to /s/ or
     /this-week/ any more, and Broomfield has no local events, so that
     check failed on every healthy deploy. The signal now is the build
     itself, which exists on every town regardless of content.
  3. The town's own signature section returns real, town-specific content
     -- checked against a literal marker string, not a generic "page looks
     non-empty" heuristic.

DEFAULT_BUILT_AT_MAX_HOURS=14: the scrape cron runs twice a day (11:00 and
23:00 UTC, 12 h apart) and every run rebuilds; 2 h of slack. A deploy
check runs right after a build, so a stale value means the edge is serving
an old page.

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

from scrapers.user_agent import user_agent_for_domain

DEFAULT_BUILT_AT_MAX_HOURS = 14

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
    return user_agent_for_domain(site_url)


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


_BUILD_SHA_RE = re.compile(r'<meta\s+name="build-sha"\s+content="([0-9a-f]+)"')


def extract_build_sha(html: str) -> str | None:
    """The deploying commit's SHA, read from BaseLayout.astro's own
    <meta name="build-sha"> tag (site/src/layouts/BaseLayout.astro) --
    None if the tag is absent entirely (shouldn't happen on a real build;
    BaseLayout.astro falls back to the literal string 'local' when
    GITHUB_SHA isn't set, which this regex deliberately does NOT match --
    only a real hex SHA counts). Pure, no network -- unit tested directly."""
    match = _BUILD_SHA_RE.search(html)
    return match.group(1) if match else None


_BUILT_AT_RE = re.compile(r'<meta\s+name="data-built-at"\s+content="([^"]+)"')


def extract_built_at(html: str) -> datetime | None:
    """The build time from BaseLayout.astro's <meta name="data-built-at">
    (tz-aware UTC), or None when the tag is missing or not an ISO time.
    Pure, no network -- unit tested directly."""
    match = _BUILT_AT_RE.search(html)
    if match is None:
        return None
    try:
        built = datetime.fromisoformat(match.group(1).replace("Z", "+00:00"))
    except ValueError:
        return None
    return built if built.tzinfo else built.replace(tzinfo=timezone.utc)


def evaluate_built_at(html: str, max_hours: float, now: datetime) -> str | None:
    """Error text when the page has no usable build time, or it is older
    than `max_hours` (or in the future by more than an hour: a broken
    clock), None when fine. Pure, `now` injectable. Depends on nothing but
    the page itself -- no story links, no events, no DB."""
    built = extract_built_at(html)
    if built is None:
        return 'homepage has no valid <meta name="data-built-at"> tag'
    if built < now - timedelta(hours=max_hours):
        return f"homepage was built {built.isoformat()}, older than the {max_hours:g}-hour window"
    if built > now + timedelta(hours=1):
        return f"homepage build time {built.isoformat()} is in the future"
    return None


def check_homepage_built_at(
    town_id: str,
    site_url: str,
    max_hours: float = DEFAULT_BUILT_AT_MAX_HOURS,
    reference_now: datetime | None = None,
) -> tuple[str, bool] | None:
    """Returns (error, is_transient) on failure, None on success.
    `is_transient` is True for a fetch blip (network error, non-200) and
    False for a settled content problem (missing or old build time) --
    see _run_checks_once for how that interacts with the build-sha."""
    try:
        r = requests.get(site_url + "/", timeout=20, headers=_request_headers(site_url))
    except Exception as exc:
        return f"could not fetch homepage ({site_url}/): {exc}", True
    if r.status_code != 200:
        return f"homepage returned HTTP {r.status_code}, expected 200", True
    now = reference_now if reference_now is not None else datetime.now(timezone.utc)
    err = evaluate_built_at(r.text, max_hours, now)
    return (err, False) if err else None


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


# 2026-10-15 incident (see .claude/state.md): /closures/ on Moreno Valley
# stayed stale for 20+ minutes after a build+deploy that GitHub's own API
# confirmed succeeded -- root cause was Cloudflare Workers Static Assets'
# own edge cache, which has no automatic per-deploy invalidation. Neither
# existing check above would have caught it: the build-time check only
# cares whether the page was built recently, not whether the exact bytes being
# served match this deploy, and check_signature_section never looks at
# /closures/ (or any page outside each town's one fixed path) at all. This
# check is the direct test instead: does the live homepage actually carry
# THIS deploy's own build-sha.
def check_build_sha(town_id: str, site_url: str, expected_sha: str) -> str | None:
    """Fetches the homepage with the SAME plain request a real visitor's
    browser would send (_request_headers() -- no Cache-Control/Pragma
    override) -- deliberately NOT bypassing cache, since the point is to
    verify what a real visitor actually gets right now, after the purge
    step. Forcing a no-cache revalidation would always hit origin and
    could never catch a purge that silently failed or hasn't finished
    propagating. Logs the response's own CF-Cache-Status header either
    way, for visibility into what actually happened -- not a pass/fail
    condition on its own, since a HIT with the CORRECT build-sha is a
    perfectly healthy outcome (it just means this exact response was
    already fresh when it got cached)."""
    try:
        r = requests.get(site_url + "/", timeout=20, headers=_request_headers(site_url))
    except Exception as exc:
        return f"could not fetch homepage for build-sha check ({site_url}/): {exc}"

    cf_cache_status = r.headers.get("CF-Cache-Status", "(no CF-Cache-Status header)")
    print(f"  [{town_id}] build-sha check: CF-Cache-Status={cf_cache_status}")

    if r.status_code != 200:
        return f"homepage returned HTTP {r.status_code}, expected 200 (CF-Cache-Status={cf_cache_status})"

    live_sha = extract_build_sha(r.text)
    if live_sha is None:
        return "homepage has no <meta name=\"build-sha\"> tag at all"
    if live_sha != expected_sha:
        return (
            f"homepage build-sha is {live_sha}, expected {expected_sha} -- the edge "
            f"may still be serving a stale deploy (CF-Cache-Status={cf_cache_status})"
        )
    return None


# 2026-10-01: both checks hit the live edge (Cloudflare propagation can lag
# a few seconds to low tens of seconds behind a fresh deploy) and a fresh
# Neon connection (this exact project has hit a transient "fetch failed"
# from Neon's serverless driver before, see the astro build retries this
# same day; the DB is no longer used here). Neither is a real
# content/deploy problem -- a single failed attempt right after `wrangler
# deploy` finishes is expected often enough that this used to fail the job
# on it. Retrying for a few minutes before giving up tells apart "still
# propagating" from "actually broken" without weakening the check itself:
# a genuinely broken deploy is still broken 5 minutes later and still fails
# loud, same alert as before.
RETRY_TIMEOUT_SECONDS = 300
RETRY_INTERVAL_SECONDS = 20


def _run_checks_once(
    town_id: str, site_url: str, max_hours: float, expected_sha: str | None = None,
) -> tuple[list[str], bool]:
    """One attempt at all checks. Returns (failures, retryable): failures
    is the list of failure strings (empty on success).

    retryable follows the build-sha (owner 2026-11-06). A sha that does NOT
    match (or cannot be read) means the edge may still be serving the old
    deploy (cache / propagation), which is exactly what waiting fixes, so
    the attempt is retryable. Once the live sha matches this deploy the
    edge is serving our bytes, and a missing/old build time or an empty
    signature section will look identical 5 minutes from now: not
    retryable. A fetch blip (network error, non-200, an exception) stays
    retryable. Without an expected sha (manual run) only a settled build-
    time failure is non-retryable, as before."""
    failures: list[str] = []
    permanent = False
    sig_failed = False
    sha_matches: bool | None = None
    try:
        built_err = check_homepage_built_at(town_id, site_url, max_hours)
        if built_err:
            message, is_transient = built_err
            failures.append(f"homepage build time: {message}")
            permanent |= not is_transient
        else:
            print(f"  [{town_id}] homepage build time: ok")

        sig_err = check_signature_section(town_id, site_url)
        if sig_err:
            failures.append(f"signature section: {sig_err}")
            sig_failed = True
        else:
            print(f"  [{town_id}] signature section: ok")

        if expected_sha:
            sha_err = check_build_sha(town_id, site_url, expected_sha)
            sha_matches = sha_err is None
            if sha_err:
                failures.append(f"build-sha: {sha_err}")
            else:
                print(f"  [{town_id}] build-sha: ok (matches {expected_sha})")
    except Exception as exc:  # noqa: BLE001 -- a network exception counts as a failed attempt, not a crash
        failures.append(f"attempt raised {type(exc).__name__}: {exc}")
        return failures, True
    if sha_matches is False:
        return failures, True
    if sha_matches:
        permanent |= sig_failed
    return failures, not permanent


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
    problem such as a stale build time (see _run_checks_once's retryable rule): content that's stale right now
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
    max_hours = cfg.get("freshness_check_hours", DEFAULT_BUILT_AT_MAX_HOURS)
    # Same real env var BaseLayout.astro reads at build time (see that
    # file's own comment) -- GitHub Actions already sets this in every
    # job, no workflow change needed. None on a manual/local run, which
    # just skips the build-sha check entirely (optional, additive, same
    # pattern as DEPLOY_CHECK_SECRET above).
    expected_sha = os.environ.get("GITHUB_SHA")

    failures = run_with_retry(
        lambda: _run_checks_once(town_id, site_url, max_hours, expected_sha), town_id,
    )
    if failures:
        for f in failures:
            print(f"  [{town_id}] FAIL -- {f}", file=sys.stderr)
        _alert(town_id, "; ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
