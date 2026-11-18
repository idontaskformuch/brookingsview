"""scrapers/robots.py: one mode (owner 2026-11-18): RFC 9309, our user-agent group else `*`. A URL is llm_excluded when an AI crawler's own
group disallows its path; merely naming an AI crawler is not enough (owner 2026-11-18, second decision). Neither stops the fetch.

Fixtures are live robots.txt files fetched with our own user-agent (2026-11-08; downtownbrookings 2026-11-18). The `old_strict` column
is the verdict of the removed strict mode (it refused on any AI-crawler mention), kept so the difference stays visible.
"""
from pathlib import Path

import pytest

from scrapers import robots
from scrapers.user_agent import BOT_NAME, user_agent
from sports import check

FX = Path(__file__).parent / "fixtures" / "robots"


def read(name: str) -> str:
    return (FX / f"{name}.txt").read_text(encoding="utf-8")


def _old_strict(text: str, url: str) -> bool:
    """The removed strict mode: refused whenever an AI crawler was named anywhere, else the same verdict."""
    named = any(any(b in a for b in robots.AI_BOT_TOKENS) for g in robots._groups(text) for a in g.agents)
    return not named and robots.verdict(200, text, url).ok


@pytest.mark.parametrize("fixture,url,ok,ai_bot,ai_rule,old_strict", [
    ("gojacks", "https://gojacks.com/sports/football/schedule/text", True, "ccbot", "Disallow: /", False),   # `*` allows
    ("gojacks", "https://gojacks.com/services/schedule.ashx", False, "ccbot", "Disallow: /", False),         # `*` disallows /services/
    ("gojacks", "https://gojacks.com/images/logo.jpg", False, "ccbot", "Disallow: /", False),
    # sdstate.edu (refetched 2026-11-18, unchanged): GPTBot and ClaudeBot/anthropic-ai only get /admissions/ /academics/ /news/
    # /programs/ ..., Disallow: / for the rest; Bytespider Disallow: /. The events are open to us and llm_excluded.
    ("sdstate", "https://sdstate.edu/event-calendar", True, "gptbot", "Disallow: /", False),
    ("sdstate", "https://www.sdstate.edu/events/2026/12/santa-visits-mccrory-gardens", True, "gptbot", "Disallow: /", False),
    ("sdstate", "https://www.sdstate.edu/news/x", True, "bytespider", "Disallow: /", False),  # GPTBot may read /news/, Bytespider not
    # visitbrookingssd.com: only GPTBot is kept off /events/ (owner 2026-11-18)
    ("visitbrookings", "https://visitbrookingssd.com/events/?ical=1", True, "gptbot", "Disallow: /events/", False),
    ("visitbrookings", "https://visitbrookingssd.com/event/festival-of-lights-pre-parade-party-3/", True, None, None, False),  # /event/ != /events/
    ("visitbrookings", "https://visitbrookingssd.com/events/x/page/2", False, "gptbot", "Disallow: /events/", False),
    # downtownbrookings.com (Squarespace default): the AI crawlers share the `*` rules, so a content page is NOT llm_excluded
    ("downtownbrookings", "https://www.downtownbrookings.com/festival-of-lights", True, None, None, False),
    ("downtownbrookings", "https://www.downtownbrookings.com/search", False, "anthropic-ai", "Disallow: /search", False),
    ("sdhsaa", "https://www.sdhsaa.com/sports/football", True, None, None, True),
    ("sdhsaa", "https://www.sdhsaa.com/sports/football?year=2026", False, None, None, False),    # Disallow: /*? (wildcard)
])
def test_live_fixtures_one_mode_and_the_old_strict_column(fixture, url, ok, ai_bot, ai_rule, old_strict):
    text = read(fixture)
    v = robots.verdict(200, text, url)
    assert v.ok is ok
    assert (v.ai_bot, v.ai_rule) == (ai_bot, ai_rule)
    assert v.llm_excluded is (ai_bot is not None)
    assert robots.ai_disallowed(text, url) == ((ai_bot, ai_rule) if ai_bot else None)
    assert _old_strict(text, url) is old_strict


def test_there_is_no_mode_argument_any_more():
    with pytest.raises(TypeError):
        robots.verdict(200, "", "https://x.example/a", mode="strict")  # type: ignore[call-arg]


def test_standard_names_the_group_that_applies_to_us():
    text = f"User-agent: *\nDisallow: /\n\nUser-agent: {BOT_NAME}\nAllow: /\nDisallow: /private\n"
    assert robots.verdict(200, text, "https://x.example/games").ok
    assert not robots.verdict(200, text, "https://x.example/private/a").ok


def test_other_bots_give_no_verdict_and_only_an_ai_disallow_marks_llm_excluded():
    for bot in ("GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Googlebot"):
        assert robots.verdict(200, f"User-agent: {bot}\nDisallow: /\n", "https://x.example/a").ok
    assert robots.verdict(200, "User-agent: GPTBot\nDisallow: /\n", "https://x.example/a").llm_excluded
    assert not robots.verdict(200, "User-agent: GPTBot\nAllow: /\n", "https://x.example/a").llm_excluded       # named, not disallowed
    assert not robots.verdict(200, "User-agent: GPTBot\nDisallow: /b\n", "https://x.example/a").llm_excluded  # other path
    assert not robots.verdict(200, "User-agent: Googlebot\nDisallow: /\n", "https://x.example/a").llm_excluded


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


def test_status_handling():
    assert robots.verdict(404, None, "https://x.example/").ok
    for status in (401, 403, 429, 500, None):
        assert not robots.verdict(status, "", "https://x.example/").ok


def test_crawl_delay_comes_from_the_applicable_group():
    text = f"User-agent: Other\nCrawl-delay: 2\n\nUser-agent: *\nCrawl-delay: 30\nAllow: /\n"
    assert robots.crawl_delay(text) == 30.0
    assert robots.crawl_delay(f"User-agent: {BOT_NAME}\nCrawl-delay: 5\n\nUser-agent: *\nCrawl-delay: 30\n") == 5.0
    assert robots.verdict(200, text, "https://x.example/a").crawl_delay == 30.0
    assert robots.crawl_delay(read("gojacks")) == 30.0
    assert check.crawl_delay(read("sdhsaa")) == 3.0



def test_user_agent_identifies_site_and_contact_and_is_not_an_ai_crawler(monkeypatch):
    monkeypatch.delenv("USER_AGENT", raising=False)
    for town in ("brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"):
        ua = user_agent(town)
        assert ua.startswith(f"{BOT_NAME} (+https://") and ua.endswith("/contact)")
        assert not any(b in ua.lower() for b in robots.AI_BOT_TOKENS)
