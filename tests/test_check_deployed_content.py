"""Tests for scripts/check_deployed_content.py's pure logic -- the
network/DB-touching orchestration (check_homepage_freshness,
check_signature_section) isn't unit tested directly, same convention as
the rest of this codebase (test the extracted pure function, not the I/O
wrapper around it).
"""
from datetime import datetime, timedelta, timezone

from scripts.check_deployed_content import (
    DEPLOY_CHECK_HEADER,
    SIGNATURE_SECTIONS,
    SITE_URLS,
    _request_headers,
    _user_agent,
    extract_story_slugs,
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


def test_all_three_towns_have_a_site_url_and_signature_section():
    for town_id in ("brookings_sd", "moreno_valley_ca", "broomfield_co"):
        assert town_id in SITE_URLS
        assert SITE_URLS[town_id].startswith("https://")
        assert town_id in SIGNATURE_SECTIONS
        assert SIGNATURE_SECTIONS[town_id]["path"].startswith("/")


def test_user_agent_strips_scheme_and_identifies_domain():
    assert _user_agent("https://broomfieldview.com") == (
        "broomfieldview.com (contact: hello@broomfieldview.com)"
    )


def test_user_agent_matches_scrape_workflow_convention_for_all_three_towns():
    # Same "<domain> (contact: hello@<domain>)" string each town's own
    # *-scrape.yml sets as USER_AGENT -- derived from SITE_URLS rather than
    # hardcoded a second time, so the two can't drift apart.
    for town_id, site_url in SITE_URLS.items():
        domain = site_url.removeprefix("https://")
        assert _user_agent(site_url) == f"{domain} (contact: hello@{domain})"


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
        return []

    failures = run_with_retry(check_fn, "brookings_sd", timeout_seconds=300,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == []
    assert len(calls) == 1
    assert clock.now == 0.0  # never slept


def test_retries_then_succeeds_within_the_window():
    clock = _FakeClock()
    attempts = [["still propagating"], ["still propagating"], []]

    def check_fn():
        return attempts.pop(0)

    failures = run_with_retry(check_fn, "moreno_valley_ca", timeout_seconds=300,
                               interval_seconds=20, sleep_fn=clock.sleep, clock_fn=clock.clock)
    assert failures == []
    assert clock.now == 40.0  # two sleeps of 20s before the third (successful) attempt


def test_gives_up_after_the_timeout_and_returns_the_last_failure():
    clock = _FakeClock()

    def check_fn():
        return ["still broken"]

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
        return ["broken"]

    run_with_retry(check_fn, "brookings_sd", timeout_seconds=25,
                    interval_seconds=20, sleep_fn=tracking_sleep, clock_fn=clock.clock)
    # First sleep is the full 20s interval; the second is clamped to the
    # remaining 5s, not another full 20s overshooting the 25s budget.
    assert sleeps == [20.0, 5.0]
