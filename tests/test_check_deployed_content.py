"""Tests for scripts/check_deployed_content.py: the pure logic, plus the build-time check and the
retry decision with requests.get faked (no network, no DB).
"""
from datetime import datetime, timedelta, timezone

import scripts.check_deployed_content as check_deployed_content
from scripts.check_deployed_content import (
    DEPLOY_CHECK_HEADER,
    SIGNATURE_SECTIONS,
    SITE_URLS,
    _request_headers,
    _user_agent,
    _run_checks_once,
    check_homepage_built_at,
    evaluate_built_at,
    extract_build_sha,
    extract_built_at,
    run_with_retry,
)


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


NOW = datetime(2026, 11, 6, 14, 0, tzinfo=timezone.utc)


class _FakeResponse:
    def __init__(self, status_code: int, text: str, headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


def _page(built_at: str | None = "2026-11-06T13:55:00.000Z", sha: str | None = "6573dcc1") -> str:
    """A homepage with NO /s/ or /this-week/ links and no events -- what every town serves since the AI text was removed."""
    head = ""
    if sha:
        head += f'<meta name="build-sha" content="{sha}">'
    if built_at:
        head += f'<meta name="data-built-at" content="{built_at}">'
    return f"<html><head>{head}</head><body><h1>Broomfield View</h1><p>Nothing local this week.</p></body></html>"


def test_extract_built_at_reads_the_meta_tag():
    assert extract_built_at(_page("2026-11-06T13:55:00.000Z")) == datetime(2026, 11, 6, 13, 55, tzinfo=timezone.utc)


def test_extract_built_at_none_when_missing_or_malformed():
    assert extract_built_at(_page(None)) is None
    assert extract_built_at(_page("yesterday")) is None


def test_a_homepage_without_story_links_passes_when_built_recently():
    # Regression 2026-11-06: Broomfield deploy 14:04 UTC failed "homepage has no /s/<slug>/ or /this-week/<week>/ links at all"
    # 16 times on a healthy deploy. The signal must not depend on /s/, /this-week/ or events.
    html = _page("2026-11-06T13:55:00.000Z")
    assert "/s/" not in html and "/this-week/" not in html
    assert evaluate_built_at(html, 14, NOW) is None


def test_build_time_older_than_the_window_fails():
    err = evaluate_built_at(_page("2026-11-05T20:00:00Z"), 14, NOW)
    assert err is not None and "older than the 14-hour window" in err


def test_build_time_exactly_on_the_boundary_is_fine():
    assert evaluate_built_at(_page("2026-11-06T00:00:00Z"), 14, NOW) is None


def test_missing_build_time_fails():
    assert "no valid" in evaluate_built_at(_page(None), 14, NOW)


def test_build_time_in_the_future_fails():
    assert "in the future" in evaluate_built_at(_page("2026-11-06T16:00:00Z"), 14, NOW)


def test_check_homepage_built_at_marks_fetch_problems_transient(monkeypatch):
    monkeypatch.setattr(check_deployed_content.requests, "get", lambda *a, **k: _FakeResponse(503, ""))
    message, transient = check_homepage_built_at("broomfield_co", "https://broomfieldview.com", 14, NOW)
    assert "503" in message and transient is True


def test_check_homepage_built_at_marks_a_stale_page_settled(monkeypatch):
    monkeypatch.setattr(check_deployed_content.requests, "get", lambda *a, **k: _FakeResponse(200, _page("2026-11-01T00:00:00Z")))
    message, transient = check_homepage_built_at("broomfield_co", "https://broomfieldview.com", 14, NOW)
    assert "older than" in message and transient is False


def _fake_site(monkeypatch, *, home: str, signature: str = "<p>real content</p>", status: int = 200):
    def get(url, *a, **k):
        if url.endswith("/vail-resorts/") or url.endswith("/university/") or url.endswith("/workplace-watch/"):
            return _FakeResponse(200, signature)
        return _FakeResponse(status, home)
    monkeypatch.setattr(check_deployed_content.requests, "get", get)
    # the check compares against the real clock; freeze it by making the page fresh relative to now
    return get


def _fresh_page(sha="6573dcc1"):
    return _page(datetime.now(timezone.utc).isoformat(), sha)


def test_run_checks_once_passes_on_a_linkless_homepage_with_matching_sha(monkeypatch):
    _fake_site(monkeypatch, home=_fresh_page())
    assert _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, "6573dcc1") == ([], True)


def test_matching_sha_with_a_stale_build_time_is_not_retried(monkeypatch):
    _fake_site(monkeypatch, home=_page("2026-11-01T00:00:00Z", "6573dcc1"))
    failures, retryable = _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, "6573dcc1")
    assert failures and retryable is False


def test_matching_sha_with_an_empty_signature_section_is_not_retried(monkeypatch):
    empty = SIGNATURE_SECTIONS["broomfield_co"]["empty_state_text"]
    _fake_site(monkeypatch, home=_fresh_page(), signature=empty)
    failures, retryable = _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, "6573dcc1")
    assert failures and retryable is False


def test_mismatching_sha_is_retried_even_when_the_build_time_is_stale(monkeypatch):
    # edge still serving the previous deploy: old sha AND old build time -- wait for propagation
    _fake_site(monkeypatch, home=_page("2026-11-01T00:00:00Z", "oldsha00"))
    failures, retryable = _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, "6573dcc1")
    assert failures and retryable is True


def test_a_503_on_the_homepage_is_retried(monkeypatch):
    _fake_site(monkeypatch, home="", status=503)
    failures, retryable = _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, "6573dcc1")
    assert failures and retryable is True


def test_without_an_expected_sha_a_stale_build_time_is_still_final(monkeypatch):
    _fake_site(monkeypatch, home=_page("2026-11-01T00:00:00Z", None))
    failures, retryable = _run_checks_once("broomfield_co", "https://broomfieldview.com", 14, None)
    assert failures and retryable is False


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
