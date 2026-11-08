"""scrapers/robots.py: standard (RFC 9309, our user-agent group else `*`) vs strict (also excluded when an AI crawler is named).

Fixtures are the live robots.txt files fetched 2026-11-08 with our own user-agent. The strict column is the verdict the old
robots_verdict gave (it refused on any AI-crawler mention); the standard column is the new default.
"""
from pathlib import Path

import pytest

from scrapers import robots
from scrapers.user_agent import BOT_NAME, user_agent
from sports import check

FX = Path(__file__).parent / "fixtures" / "robots"


def read(name: str) -> str:
    return (FX / f"{name}.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("fixture,url,standard,strict", [
    ("gojacks", "https://gojacks.com/sports/football/schedule/text", True, False),   # names CCBot etc.; `*` allows
    ("gojacks", "https://gojacks.com/services/schedule.ashx", False, False),         # `*` disallows /services/
    ("gojacks", "https://gojacks.com/images/logo.jpg", False, False),
    ("sdstate", "https://sdstate.edu/event-calendar", True, False),                  # names GPTBot; `*` allows
    ("visitbrookings", "https://visitbrookingssd.com/events/?ical=1", True, False),  # names GPTBot; ?ical=1 not blocked
    ("visitbrookings", "https://visitbrookingssd.com/events/x/page/2", False, False),
    ("sdhsaa", "https://www.sdhsaa.com/sports/football", True, True),
    ("sdhsaa", "https://www.sdhsaa.com/sports/football?year=2026", False, False),    # Disallow: /*? (wildcard)
])
def test_live_fixtures_before_and_after(fixture, url, standard, strict):
    text = read(fixture)
    assert robots.verdict(200, text, url).ok is standard
    assert robots.verdict(200, text, url, mode="strict").ok is strict


def test_standard_names_the_group_that_applies_to_us():
    text = f"User-agent: *\nDisallow: /\n\nUser-agent: {BOT_NAME}\nAllow: /\nDisallow: /private\n"
    assert robots.verdict(200, text, "https://x.example/games").ok
    assert not robots.verdict(200, text, "https://x.example/private/a").ok


def test_other_bots_named_gives_no_verdict_in_standard():
    for bot in ("GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Googlebot"):
        assert robots.verdict(200, f"User-agent: {bot}\nDisallow: /\n", "https://x.example/a").ok
    assert not robots.verdict(200, "User-agent: GPTBot\nAllow: /\n", "https://x.example/a", mode="strict").ok


def test_star_disallow_all_blocks_and_ours_overrides():
    assert not robots.verdict(200, "User-agent: *\nDisallow: /\n", "https://x.example/a").ok
    assert robots.verdict(200, f"User-agent: *\nDisallow: /\n\nUser-agent: {BOT_NAME}\nDisallow:\n", "https://x.example/a").ok


def test_longest_match_wins_and_allow_wins_a_tie():
    text = "User-agent: *\nDisallow: /a\nAllow: /a/open\nDisallow: /a/open/secret\n"
    assert not robots.verdict(200, text, "https://x.example/a/b").ok
    assert robots.verdict(200, text, "https://x.example/a/open/x").ok
    assert not robots.verdict(200, text, "https://x.example/a/open/secret/1").ok
    assert robots.verdict(200, "User-agent: *\nDisallow: /a\nAllow: /a\n", "https://x.example/a").ok


def test_wildcard_and_end_anchor():
    text = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/\n"
    assert not robots.verdict(200, text, "https://x.example/docs/a.pdf").ok
    assert robots.verdict(200, text, "https://x.example/docs/a.pdf.html").ok
    assert not robots.verdict(200, text, "https://x.example/tmp123/x").ok


def test_status_handling_is_unchanged_in_both_modes():
    for mode in robots.MODES:
        assert robots.verdict(404, None, "https://x.example/", mode=mode).ok
        for status in (401, 403, 429, 500, None):
            assert not robots.verdict(status, "", "https://x.example/", mode=mode).ok


def test_crawl_delay_comes_from_the_applicable_group():
    text = f"User-agent: Other\nCrawl-delay: 2\n\nUser-agent: *\nCrawl-delay: 30\nAllow: /\n"
    assert robots.crawl_delay(text) == 30.0
    assert robots.crawl_delay(f"User-agent: {BOT_NAME}\nCrawl-delay: 5\n\nUser-agent: *\nCrawl-delay: 30\n") == 5.0
    assert robots.verdict(200, text, "https://x.example/a").crawl_delay == 30.0
    assert robots.crawl_delay(read("gojacks")) == 30.0
    assert check.crawl_delay(read("sdhsaa")) == 3.0


def test_unknown_mode_is_an_error():
    with pytest.raises(ValueError):
        robots.verdict(200, "", "https://x.example/", mode="loose")


def test_user_agent_identifies_site_and_contact_and_is_not_an_ai_crawler(monkeypatch):
    monkeypatch.delenv("USER_AGENT", raising=False)
    for town in ("brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"):
        ua = user_agent(town)
        assert ua.startswith(f"{BOT_NAME} (+https://") and ua.endswith("/contact)")
        assert not any(b in ua.lower() for b in robots.AI_BOT_TOKENS)
