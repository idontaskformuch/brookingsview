"""scripts/watch_robots_unblock.py (owner order 2026-11-25/26): one issue + alert when broomfield.org's robots.txt stops blocking the city
calendar feeds. Fixture: broomfield.org/robots.txt as read 2026-11-26 (PoliteFetcher, one request)."""
from pathlib import Path

from scrapers import robots as _robots
from scripts import watch_robots_unblock as w

ROBOTS = (Path(__file__).parent / "fixtures" / "robots" / "broomfield-2026-11-26.txt").read_text(encoding="utf-8")


class FakeFetcher:
    def __init__(self, status, text):
        self.status, self.text, self.calls = status, text, []

    def robots_verdict(self, url):
        self.calls.append(url)
        return _robots.verdict(self.status, self.text, url)

    def robots_text(self, url):
        return self.status, self.text


def test_the_four_feeds_come_from_the_config():
    urls = w.ical_urls()
    assert len(urls) == 4 and all("/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=" in u for u in urls)


def test_todays_robots_txt_blocks_every_feed_and_opens_nothing():
    status, verdicts = w.check(FakeFetcher(200, ROBOTS))
    assert verdicts and not any(verdicts.values())
    assert w.findings(status, verdicts) == []


def test_the_parser_itself_blocks_the_mixed_case_feed_path():
    # owner 2026-11-26: a Disallow applies in any case (stricter than RFC 9309); the rule reads /common/modules/icalendar/
    for url in w.ical_urls():
        assert not _robots.verdict(200, ROBOTS, url).ok


def test_without_the_icalendar_rule_one_finding_names_every_feed():
    # the only change to the real file: both "Disallow: /common/modules/icalendar/" lines removed
    opened = "\n".join(l for l in ROBOTS.splitlines() if l.strip().lower() != "disallow: /common/modules/icalendar/")
    status, verdicts = w.check(FakeFetcher(200, opened))
    found = w.findings(status, verdicts)
    assert len(found) == 1 and found[0]["check"] == "ops.robots-unblocked" and found[0]["town"] == "broomfield_co"
    assert all(u in found[0]["message"] for u in w.ical_urls())


def test_an_unreadable_robots_txt_says_nothing():
    for status in (None, 403, 503):
        assert w.findings(status, {u: True for u in w.ical_urls()}) == []


def test_the_check_is_registered_and_runs_daily_with_alert_and_issue_rights():
    from qa.report import REGISTRY
    assert "ops.robots-unblocked" in REGISTRY
    wf = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "robots-watch.yml").read_text(encoding="utf-8")
    assert "python -m scripts.watch_robots_unblock" in wf and "issues: write" in wf and "ALERT_WEBHOOK" in wf and "schedule:" in wf
