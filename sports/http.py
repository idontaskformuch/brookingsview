"""Polite fetching for sports adapters: robots.txt per host, Crawl-delay honoured in full, no retries around a refusal.

* The robots verdict comes from scrapers.robots (mode per source: "standard" | "strict").
* A Crawl-delay applies in full between any two requests to the same host (the robots.txt fetch counts as one). It is never shortened.
  A delay above `max_crawl_delay` (seconds, default 60) skips the source (SourceSkipped); there is no faster fetch instead.
* A 401/403/429 answer is a no (CLAUDE.md rule 13): SourceSkipped, no second attempt, no other identity.
"""
from __future__ import annotations

import time
from urllib.parse import urlparse

from scrapers import robots
from scrapers.user_agent import user_agent

DEFAULT_MAX_CRAWL_DELAY = 60.0
REFUSED = (401, 403, 429)


class SourceSkipped(Exception):
    """The source must not be fetched. The text goes to sport_sources_health. kind: "robots" | "delay" (above max_crawl_delay) | "refused" (401/403/429)."""

    def __init__(self, reason: str, kind: str = "robots") -> None:
        super().__init__(reason)
        self.kind = kind


def default_get(url: str, ua: str) -> tuple[int | None, str]:
    import requests
    try:
        res = requests.get(url, headers={"User-Agent": ua}, timeout=20)
        return res.status_code, res.text
    except requests.RequestException:
        return None, ""


class PoliteHttp:
    def __init__(self, ua: str | None = None, *, mode: str = robots.DEFAULT_MODE, max_crawl_delay: float = DEFAULT_MAX_CRAWL_DELAY,
                 get=default_get, sleep=time.sleep, clock=time.monotonic) -> None:
        self.ua = ua or user_agent()
        self.mode = mode
        self.max_crawl_delay = max_crawl_delay
        self._get, self._sleep, self._clock = get, sleep, clock
        self._robots: dict[str, tuple[int | None, str]] = {}
        self._last: dict[str, float] = {}
        self.crawl_delay: float | None = None  # the largest delay seen, for reports
        self.waited = 0.0

    def _wait(self, host: str, delay: float) -> None:
        if host in self._last and delay:
            remaining = delay - (self._clock() - self._last[host])
            if remaining > 0:
                self._sleep(remaining)
                self.waited += remaining
        self._last[host] = self._clock()

    def preflight(self, url: str) -> robots.Verdict:
        """Fetch (once per host) and apply robots.txt. Raises SourceSkipped on a no."""
        parts = urlparse(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            self._robots[host] = self._get(f"{host}/robots.txt", self.ua)
            self._last[host] = self._clock()
        status, text = self._robots[host]
        verdict = robots.verdict(status, text, url, mode=self.mode)
        if not verdict.ok:
            raise SourceSkipped(verdict.reason)
        if verdict.crawl_delay:
            self.crawl_delay = max(self.crawl_delay or 0.0, verdict.crawl_delay)
            if verdict.crawl_delay > self.max_crawl_delay:
                raise SourceSkipped(f"robots.txt Crawl-delay {verdict.crawl_delay:g}s is above max_crawl_delay {self.max_crawl_delay:g}s", "delay")
        return verdict

    def get_text(self, url: str) -> str:
        verdict = self.preflight(url)
        host = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        self._wait(host, verdict.crawl_delay or 0.0)
        status, text = self._get(url, self.ua)
        if status in REFUSED:
            raise SourceSkipped(f"{urlparse(url).path or '/'} answered {status}: treated as a no, not retried", "refused")
        if status != 200:
            raise RuntimeError(f"{urlparse(url).path or '/'} answered {status}")
        return text
