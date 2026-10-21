"""Tests for scripts/check_deployed_content.py's pure logic -- the
network/DB-touching orchestration (check_homepage_freshness,
check_signature_section) isn't unit tested directly, same convention as
the rest of this codebase (test the extracted pure function, not the I/O
wrapper around it).
"""
from datetime import datetime, timedelta, timezone

import scripts.check_deployed_content as check_deployed_content
from scripts.check_deployed_content import (
    DEPLOY_CHECK_HEADER,
    SIGNATURE_SECTIONS,
    SITE_URLS,
    _request_headers,
    _user_agent,
    check_homepage_freshness,
    extract_build_sha,
    extract_story_slugs,
    extract_weekly_slugs,
    is_stale,
    resolve_homepage_slugs_to_db_slugs,
    run_with_retry,
)


def test_extract_story_slugs_finds_all_distinct_links():
    html = '<a href="/s/meeting-2026-08-04/">x</a><a href="/s/recipe-2026-08-27/">y</a>'
    assert extract_story_slugs(html) == ["meeting-2026-08-04", "recipe-2026-08-27"]


def test_extract_story_slugs_dedupes():
    html = '<a href="/s/foo/">a</a><a href="/s/foo/">b again</a>'
    assert extract_story_slugs(html) == ["foo"]


def test_extract_story_slugs_ignores_non_story_links():
    html = '<a href="/university/">x</a><a href="/this-week/2026-w35/">y</a>'
    assert extract_story_slugs(html) == []


def test_extract_story_slugs_empty_page():
    assert extract_story_slugs("<html><body>nothing here</body></html>") == []


def test_extract_weekly_slugs_maps_to_the_backing_db_slug():
    html = '<a href="/this-week/2026-w42/">This week</a>'
    assert extract_weekly_slugs(html) == ["weekly-2026-w42"]


def test_extract_weekly_slugs_dedupes_and_sorts():
    html = (
        '<a href="/this-week/2026-w42/">a</a>'
        '<a href="/this-week/2026-w41/">b</a>'
        '<a href="/this-week/2026-w42/">c again</a>'
    )
    assert extract_weekly_slugs(html) == ["weekly-2026-w41", "weekly-2026-w42"]


def test_extract_weekly_slugs_ignores_story_links():
    html = '<a href="/s/meeting-2026-10-02/">x</a>'
    assert extract_weekly_slugs(html) == []


def test_extract_build_sha_finds_the_meta_tag():
    html = '<head><meta name="build-sha" content="9fddfcff8a1b2c3d4e5f6071829304a5b6c7d8e" /></head>'
    assert extract_build_sha(html) == "9fddfcff8a1b2c3d4e5f6071829304a5b6c7d8e"


def test_extract_build_sha_none_when_tag_is_absent():
    assert extract_build_sha("<head><title>x</title></head>") is None


def test_extract_build_sha_none_for_the_local_dev_fallback_value():
    # BaseLayout.astro renders content="local" when GITHUB_SHA isn't set
    # (a local build) -- the regex only matches hex, so this is correctly
    # treated the same as "no real build-sha", never a false match.
    html = '<meta name="build-sha" content="local" />'
    assert extract_build_sha(html) is None


def test_resolve_homepage_slugs_to_db_slugs_maps_all_four_renamed_prefixes():
    # Bug fix 2026-10-02: these four public prefixes (site/src/lib/content-
    # slugs.ts's OLD_PREFIX_TO_PUBLIC) diverge from the DB's own slug column
    # since 8a0a938 -- a direct `slug = ANY(homepage_slugs)` match against
    # stories.slug can never match any of them, however fresh.
    assert resolve_homepage_slugs_to_db_slugs(["recipe-2026-08-27"]) == ["vardagsmiddag-2026-08-27"]
    assert resolve_homepage_slugs_to_db_slugs(["science-column-2026-09-01"]) == ["vetenskap_kronika-2026-09-01"]
    assert resolve_homepage_slugs_to_db_slugs(["quick-essay-2026-09-15"]) == ["kvick_essa-2026-09-15"]
    assert resolve_homepage_slugs_to_db_slugs(["review-2026-09-30"]) == ["media_recension-2026-09-30"]


def test_resolve_homepage_slugs_to_db_slugs_passes_through_unrenamed_types():
    # meeting/event/editorial/weekly/... slugs already match their DB column
    # directly -- must stay byte-for-byte unchanged, not just "unbroken".
    slugs = ["meeting-2026-10-14-11337", "event-9981", "editorial-2026-09-08", "weekly-2026-w40"]
    assert resolve_homepage_slugs_to_db_slugs(slugs) == slugs


def test_resolve_homepage_slugs_to_db_slugs_does_not_mis_split_hyphenated_public_prefixes():
    # "science-column" and "quick-essay" each contain their own internal
    # hyphen -- a naive split on the first "-" would wrongly cut
    # "science-column-2026-10-02" into "science" / "column-2026-10-02".
    # Confirms the regex matches the LONGEST known prefix, not the first
    # hyphen-delimited token.
    result = resolve_homepage_slugs_to_db_slugs(["science-column-2026-10-02", "quick-essay-2026-10-02"])
    assert result == ["vetenskap_kronika-2026-10-02", "kvick_essa-2026-10-02"]


def test_is_stale_none_counts_as_stale():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert is_stale(None, 2, now) is True


def test_is_stale_within_window_is_fresh():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=1)
    assert is_stale(published, 2, now) is False


def test_is_stale_exactly_on_boundary_is_still_fresh():
    # strict "<" in is_stale -- exactly `freshness_days` old still counts
    # as fresh, only OLDER than the window is stale.
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=2)
    assert is_stale(published, 2, now) is False


def test_is_stale_older_than_window_is_stale():
    now = datetime(2026, 8, 28, tzinfo=timezone.utc)
    published = now - timedelta(days=10)
    assert is_stale(published, 2, now) is True


# 2026-10-13: Broomfield freshness outage follow-up. check_homepage_
# freshness() now has to query the DB for /this-week/ links too (not just
# /s/ ones), which test_is_stale_* above can't exercise since they call the
# pure is_stale() helper directly -- these use a minimal fake psycopg
# connection/cursor instead of a real DB, and monkeypatch requests.get
# instead of hitting a real site, same "test the pure/injectable seam, not
# real I/O" convention the rest of this file already follows.
class _FakeResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


class _FakeCursor:
    def __init__(self, result):
        self._result = result

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, *args, **kwargs):
        pass

    def fetchone(self):
        return (self._result,)


class _FakeConn:
    """`result` is whatever max(published_at) should come back as."""
    def __init__(self, result):
        self._result = result

    def cursor(self):
        return _FakeCursor(self._result)


def test_check_homepage_freshness_accepts_a_fresh_weekly_link(monkeypatch):
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    published = now - timedelta(days=1)
    html = '<a href="/this-week/2026-w42/">This week in Broomfield</a>'
    monkeypatch.setattr(
        check_deployed_content.requests, "get",
        lambda *args, **kwargs: _FakeResponse(200, html),
    )
    conn = _FakeConn(published)
    result = check_homepage_freshness(
        conn, "broomfield_co", "https://broomfieldview.com", 8, reference_now=now,
    )
    assert result is None


def test_check_homepage_freshness_treats_zero_links_as_transient(monkeypatch):
    # A homepage with NO /s/ or /this-week/ links at all is indistinguishable
    # from mid-deploy propagation lag -- must stay retryable (is_transient
    # True), unlike the two genuine-content-problem cases below.
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    monkeypatch.setattr(
        check_deployed_content.requests, "get",
        lambda *args, **kwargs: _FakeResponse(200, "<html><body>nothing here</body></html>"),
    )
    conn = _FakeConn(None)  # never reached -- no links means no DB query
    result = check_homepage_freshness(
        conn, "broomfield_co", "https://broomfieldview.com", 8, reference_now=now,
    )
    assert result is not None
    message, transient = result
    assert "no /s/<slug>/ or /this-week/<week>/ links at all" in message
    assert transient is True


def test_check_homepage_freshness_treats_unmatched_links_as_non_transient(monkeypatch):
    # Links are present but match no real DB row (e.g. the 2026-10-02
    # slug-prefix bug this script already guards against) -- a genuine
    # content/code problem, not something a retry can fix.
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    html = '<a href="/this-week/2026-w42/">This week</a>'
    monkeypatch.setattr(
        check_deployed_content.requests, "get",
        lambda *args, **kwargs: _FakeResponse(200, html),
    )
    conn = _FakeConn(None)  # max(published_at) finds nothing
    result = check_homepage_freshness(
        conn, "broomfield_co", "https://broomfieldview.com", 8, reference_now=now,
    )
    assert result is not None
    message, transient = result
    assert "matched a real DB row" in message
    assert transient is False


def test_check_homepage_freshness_rejects_a_weekly_link_older_than_the_window(monkeypatch):
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    published = now - timedelta(days=11)
    html = '<a href="/this-week/2026-w40/">This week in Broomfield</a>'
    monkeypatch.setattr(
        check_deployed_content.requests, "get",
        lambda *args, **kwargs: _FakeResponse(200, html),
    )
    conn = _FakeConn(published)
    result = check_homepage_freshness(
        conn, "broomfield_co", "https://broomfieldview.com", 8, reference_now=now,
    )
    assert result is not None
    message, transient = result
    assert "older than the 8-day freshness window" in message
    assert transient is False


def test_all_three_towns_have_a_site_url_and_signature_section():
    for town_id in ("brookings_sd", "moreno_valley_ca", "broomfield_co"):
        assert town_id in SITE_URLS
        assert SITE_URLS[town_id].startswith("https://")
        assert town_id in SIGNATURE_SECTIONS
        assert SIGNATURE_SECTIONS[town_id]["path"].startswith("/")


def test_user_agent_strips_scheme_and_identifies_domain():
    assert _user_agent("https://broomfieldview.com") == (
        "ViewMediaBot (+https://broomfieldview.com/contact)"
    )


def test_user_agent_matches_scrape_workflow_convention_for_all_three_towns():
    # Same neutral "ViewMediaBot (+https://<domain>/contact)" string each town's own
    # *-scrape.yml sets as USER_AGENT -- derived from SITE_URLS rather than
    # hardcoded a second time, so the two can't drift apart.
    for town_id, site_url in SITE_URLS.items():
        domain = site_url.removeprefix("https://")
        assert _user_agent(site_url) == f"ViewMediaBot (+https://{domain}/contact)"


def test_request_headers_omits_bypass_header_when_secret_unset(monkeypatch):
    # Broomfield 403 follow-up: the User-Agent fix alone didn't clear
    # Cloudflare's bot-management block on GitHub Actions' runner IPs (see
    # this module's own DEPLOY_CHECK_HEADER comment) -- DEPLOY_CHECK_SECRET
    # unset must behave exactly as before that follow-up, for the two towns
    # without a matching Cloudflare rule yet.
    monkeypatch.delenv("DEPLOY_CHECK_SECRET", raising=False)
    headers = _request_headers("https://brookingsview.com")
    assert headers == {"User-Agent": _user_agent("https://brookingsview.com")}
    assert DEPLOY_CHECK_HEADER not in headers


def test_request_headers_adds_bypass_header_when_secret_set(monkeypatch):
    monkeypatch.setenv("DEPLOY_CHECK_SECRET", "test-secret-value")
    headers = _request_headers("https://broomfieldview.com")
    assert headers[DEPLOY_CHECK_HEADER] == "test-secret-value"
    assert headers["User-Agent"] == _user_agent("https://broomfieldview.com")


# 2026-10-02: run_with_retry() itself -- added after moval-deploy and
# broomfield-deploy both failed this exact step on a single attempt right
# after a fresh deploy (Cloudflare propagation / a transient Neon
# connection blip, the same class of flake this project's own astro builds
# hit the same day -- see check_deployed_content.py's own module comment
# above RETRY_TIMEOUT_SECONDS). A real clock/sleep would make this suite
# take 5 real minutes per failing-forever case, so both are injected fakes.
class _FakeClock:
    """Advances only when sleep_fn is called -- time.monotonic() is called
    an extra time at loop entry and after each attempt in run_with_retry(),
    so this must behave like a real monotonic clock (readable any number of
    times without advancing on its own), not a queue of fixed return
    values."""
    def __init__(self):
        self.now = 0.0

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def test_succeeds_immediately_without_ever_sleeping():
    clock = _FakeClock()
    calls = []

    def check_fn():
        calls.append(1)
        return [], True

    failures = run_with_retry(check_fn, "brookings_sd", timeout_seconds=300,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == []
    assert len(calls) == 1
    assert clock.now == 0.0  # never slept


def test_retries_then_succeeds_within_the_window():
    # Transient failures (retryable=True) -- the scenario this loop was
    # originally built for (Cloudflare propagation / a Neon blip).
    clock = _FakeClock()
    attempts = [(["still propagating"], True), (["still propagating"], True), ([], True)]

    def check_fn():
        return attempts.pop(0)

    failures = run_with_retry(check_fn, "moreno_valley_ca", timeout_seconds=300,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == []
    assert clock.now == 40.0  # two sleeps of 20s before the third (successful) attempt


def test_gives_up_after_the_timeout_and_returns_the_last_failure():
    clock = _FakeClock()

    def check_fn():
        return ["still broken"], True

    failures = run_with_retry(check_fn, "broomfield_co", timeout_seconds=50,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == ["still broken"]
    # 0s, 20s, 40s attempts all fail; at 40s, 10s remain (< interval), one
    # final short sleep, then the attempt at 50s also fails and the budget
    # is exhausted -- never sleeps PAST the timeout.
    assert clock.now == 50.0


def test_never_sleeps_longer_than_the_remaining_budget():
    clock = _FakeClock()
    sleeps: list[float] = []

    def tracking_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock.sleep(seconds)

    def check_fn():
        return ["broken"], True

    run_with_retry(check_fn, "brookings_sd", timeout_seconds=25,
                    interval_seconds=20, sleep_fn=tracking_sleep, clock_fn=clock.clock)
    # First sleep is the full 20s interval; the second is clamped to the
    # remaining 5s, not another full 20s overshooting the 25s budget.
    assert sleeps == [20.0, 5.0]


# 2026-10-13: Broomfield freshness outage follow-up -- a non-transient
# failure (homepage freshness: genuinely nothing fresh linked) must fail
# on the FIRST attempt, never sleep, and never touch the retry budget --
# retrying content that's exactly as stale 20s/5min from now wastes CI
# time without ever changing the outcome (see run_with_retry's own
# docstring). Contrast with test_retries_then_succeeds_within_the_window
# above, which proves a transient failure still gets the old retry
# behavior.
def test_non_retryable_failure_fails_on_the_first_attempt_without_sleeping():
    clock = _FakeClock()
    calls = []

    def check_fn():
        calls.append(1)
        return ["homepage freshness: stale"], False

    failures = run_with_retry(check_fn, "broomfield_co", timeout_seconds=300,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == ["homepage freshness: stale"]
    assert len(calls) == 1
    assert clock.now == 0.0  # never slept, gave up immediately
