"""sports/http.py: Crawl-delay is honoured in full (never shortened), max_crawl_delay skips, a refusal is a no (no fake network)."""
from pathlib import Path

import pytest

from sports.http import PoliteHttp, SourceSkipped

GOJACKS_ROBOTS = (Path(__file__).parent / "fixtures" / "robots" / "gojacks.txt").read_text(encoding="utf-8")
PAGE = "https://gojacks.com/sports/football/schedule/text"


class Net:
    """Fake network + clock: time only moves when the code sleeps (or a request 'takes' no time)."""

    def __init__(self, robots=GOJACKS_ROBOTS, page_status=200):
        self.now, self.sleeps, self.requests = 0.0, [], []
        self.robots, self.page_status = robots, page_status

    def get(self, url, ua):
        self.requests.append((self.now, url, ua))
        return (200, self.robots) if url.endswith("/robots.txt") else (self.page_status, "<html></html>")

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def clock(self):
        return self.now

    def http(self, **kw):
        return PoliteHttp("UA-test", get=self.get, sleep=self.sleep, clock=self.clock, **kw)


def test_gojacks_crawl_delay_is_30_seconds_between_requests_not_10():
    net = Net()
    http = net.http()
    http.get_text(PAGE)
    http.get_text(PAGE.replace("football", "mens-basketball"))
    assert net.sleeps == [30.0, 30.0]                      # robots.txt -> page 1 -> page 2, each 30 s apart
    gaps = [b[0] - a[0] for a, b in zip(net.requests, net.requests[1:])]
    assert gaps == [30.0, 30.0] and http.waited == 60.0 and http.crawl_delay == 30.0


def test_time_already_passed_counts_towards_the_delay():
    net = Net()
    http = net.http()
    http.preflight(PAGE)
    net.now += 12
    http.get_text(PAGE)
    assert net.sleeps == [18.0]


def test_delay_above_max_crawl_delay_skips_without_any_page_request():
    net = Net(robots="User-agent: *\nCrawl-delay: 90\n")
    with pytest.raises(SourceSkipped) as exc:
        net.http().get_text(PAGE)
    assert exc.value.kind == "delay" and "max_crawl_delay" in str(exc.value)
    assert net.sleeps == [] and [r[1] for r in net.requests] == ["https://gojacks.com/robots.txt"]


def test_max_crawl_delay_is_configurable_and_default_is_60():
    robots = "User-agent: *\nCrawl-delay: 90\n"
    net = Net(robots=robots)
    net.http(max_crawl_delay=120).get_text(PAGE)
    assert net.sleeps == [90.0]
    net = Net(robots="User-agent: *\nCrawl-delay: 60\n")
    net.http().get_text(PAGE)                              # exactly 60 is within the default limit
    assert net.sleeps == [60.0]


def test_robots_disallow_and_refusal_are_skips_never_retried():
    net = Net(robots="User-agent: *\nDisallow: /sports/\n")
    with pytest.raises(SourceSkipped) as exc:
        net.http().get_text(PAGE)
    assert exc.value.kind == "robots"
    net = Net(page_status=403)
    with pytest.raises(SourceSkipped) as exc:
        net.http().get_text(PAGE)
    assert exc.value.kind == "refused"
    assert sum(1 for r in net.requests if r[1] == PAGE) == 1


def test_other_status_is_an_error_not_a_skip():
    with pytest.raises(RuntimeError):
        Net(page_status=500).http().get_text(PAGE)


def test_identifies_with_the_given_user_agent_on_every_request():
    net = Net()
    net.http().get_text(PAGE)
    assert {r[2] for r in net.requests} == {"UA-test"}


# --- one retry for "no answer" and 5xx, never for a refusal ---------------------------------------------------------------

class Flaky(Net):
    """Answers the page with the given statuses in turn (the last one repeats)."""

    def __init__(self, statuses, **kw):
        super().__init__(**kw)
        self.statuses = list(statuses)

    def get(self, url, ua):
        if url.endswith("/robots.txt"):
            return super().get(url, ua)
        self.requests.append((self.now, url, ua))
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return status, ("<html>ok</html>" if status == 200 else "")


@pytest.mark.parametrize("first", [None, 500, 502, 503])
def test_no_answer_or_5xx_gets_one_more_attempt_after_the_crawl_delay(first):
    net = Flaky([first, 200])
    assert net.http().get_text(PAGE) == "<html>ok</html>"
    page_requests = [r for r in net.requests if r[1] == PAGE]
    assert len(page_requests) == 2 and page_requests[1][0] - page_requests[0][0] == 30.0  # gojacks: Crawl-delay 30 s between the two


def test_a_second_failure_raises_after_exactly_two_requests():
    net = Flaky([None])
    with pytest.raises(RuntimeError, match="answered None.*after one retry"):
        net.http().get_text(PAGE)
    assert sum(1 for r in net.requests if r[1] == PAGE) == 2


@pytest.mark.parametrize("status", [401, 403, 429])
def test_a_refusal_is_never_retried_not_even_after_a_failed_first_attempt(status):
    net = Flaky([status])
    with pytest.raises(SourceSkipped):
        net.http().get_text(PAGE)
    assert sum(1 for r in net.requests if r[1] == PAGE) == 1
    net = Flaky([None, status])  # first attempt fails, the retry is refused: that is a no as well, and there is no third try
    with pytest.raises(SourceSkipped):
        net.http().get_text(PAGE)
    assert sum(1 for r in net.requests if r[1] == PAGE) == 2


@pytest.mark.parametrize("status", [400, 404, 410])
def test_other_client_errors_are_not_retried(status):
    net = Flaky([status])
    with pytest.raises(RuntimeError):
        net.http().get_text(PAGE)
    assert sum(1 for r in net.requests if r[1] == PAGE) == 1


def test_a_host_without_crawl_delay_still_waits_before_the_retry():
    net = Flaky([None, 200], robots="User-agent: *\nAllow: /\n")
    net.http().get_text(PAGE)
    page_requests = [r for r in net.requests if r[1] == PAGE]
    assert page_requests[1][0] - page_requests[0][0] == 2.0
