"""Dry-run every configured sports source for a town: reachable, robots OK, event count, date range, sports found. Writes nothing.

    python -m sports.check --town broomfield_co
    python -m sports.check --validate-all        # config validation only, for every town (exit 1 on any problem)

robots_mode per source: "standard" (default, RFC 9309 group for our user-agent, else `*`) or "strict" (also excluded when an AI crawler is named).
A source whose robots.txt disallows us (or answers 403/anything but 200/404) is reported as skipped and its adapter is NOT called.
Per CLAUDE.md rule 13 a 403 is a no; there is no retry with another identity.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from scrapers import robots
from scrapers.user_agent import user_agent
from sports import adapters
from sports.http import DEFAULT_MAX_CRAWL_DELAY, PoliteHttp, SourceSkipped, default_get
from sports.config import validate_sports_config
from sports.models import NormalizedEvent, NormalizedStanding

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


@dataclass
class SourceReport:
    label: str
    reachable: bool = False
    robots_ok: bool | None = None       # None = the source has no URL to check (API adapters)
    robots_note: str = ""
    events: int = 0
    standings: int = 0
    first: str | None = None
    last: str | None = None
    sports: list[str] = field(default_factory=list)
    error: str | None = None
    crawl_delay: float | None = None    # seconds the source asks for between requests
    waited: float = 0.0                 # seconds actually waited because of it

    def line(self) -> str:
        robots = "n/a" if self.robots_ok is None else ("ok" if self.robots_ok else f"BLOCKED ({self.robots_note})")
        if self.error:
            delay = f" crawl-delay={self.crawl_delay:g}s" if self.crawl_delay else ""
            return f"{self.label}: reachable={'yes' if self.reachable else 'no'} robots={robots}{delay} ERROR {self.error}"
        span = f"{self.first}..{self.last}" if self.first else "-"
        delay = f" crawl-delay={self.crawl_delay:g}s waited={self.waited:.0f}s" if self.crawl_delay else ""
        return (f"{self.label}: reachable=yes robots={robots}{delay} events={self.events} standings={self.standings} "
                f"range={span} sports={','.join(self.sports) or '-'}")


def crawl_delay(robots_text: str) -> float | None:
    """Crawl-delay of the group that applies to us (our own product token, else `*`)."""
    return robots.crawl_delay(robots_text)


def check_source(source: dict, town_id: str, *, get=default_get, sleep=time.sleep) -> SourceReport:
    name = source.get("adapter", "?")
    label = f"{name}" + (f" [{source['program']}/{source.get('sport', '*')}]" if source.get("program") else "")
    report = SourceReport(label=label)
    params = adapters.merged_params(source)
    url = params.get("url")
    http = PoliteHttp(user_agent(town_id), mode=source.get("robots_mode", robots.DEFAULT_MODE),
                      max_crawl_delay=source.get("max_crawl_delay", DEFAULT_MAX_CRAWL_DELAY), get=get, sleep=sleep)
    params["_http"] = http
    if url:
        try:
            http.preflight(url)
            report.robots_ok = True
            report.robots_note = "ok"
        except SourceSkipped as exc:
            report.robots_ok = exc.kind != "robots"
            report.robots_note = str(exc)
            report.crawl_delay = http.crawl_delay
            report.error = f"skipped, adapter not called ({exc})"
            return report
    try:
        rows = adapters.get(name)(params)
    except SourceSkipped as exc:
        report.error = f"skipped ({exc})"
        report.crawl_delay, report.waited = http.crawl_delay, http.waited
        return report
    except Exception as exc:  # a dry run reports every failure instead of stopping
        report.error = f"{type(exc).__name__}: {exc}"[:200]
        return report
    report.reachable = True
    report.crawl_delay, report.waited = http.crawl_delay, http.waited
    events = [r for r in rows if isinstance(r, NormalizedEvent)]
    report.events = len(events)
    report.standings = sum(isinstance(r, NormalizedStanding) for r in rows)
    if events:
        stamps = sorted(e.start_at for e in events)
        report.first, report.last = stamps[0].date().isoformat(), stamps[-1].date().isoformat()
        report.sports = sorted({e.sport for e in events})
    return report


def check_town(cfg: dict, *, get=default_get, sleep=time.sleep) -> tuple[list[str], list[SourceReport]]:
    problems = validate_sports_config(cfg)
    if problems:
        return problems, []
    block = cfg.get("sports")
    if not block:
        return [f"{cfg.get('town_id', '?')}: no sports block"], []
    return [], [check_source(s, cfg["town_id"], get=get, sleep=sleep) for s in block.get("sources") or []]


def load_configs() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(CONFIG_DIR.glob("*.json"))}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="sports.check")
    ap.add_argument("--town")
    ap.add_argument("--validate-all", action="store_true")
    args = ap.parse_args(argv)
    configs = load_configs()
    if args.validate_all:
        problems = [m for cfg in configs.values() for m in validate_sports_config(cfg)]
        for m in problems:
            print(m)
        print(f"sports config: {len(problems)} problem(s) in {len(configs)} town config(s)")
        return 1 if problems else 0
    if not args.town:
        ap.error("give --town <town> or --validate-all")
    if args.town not in configs:
        print(f"unknown town {args.town!r}; known: {', '.join(configs)}")
        return 2
    problems, reports = check_town(configs[args.town])
    for m in problems:
        print(m)
    if reports:
        print(f"user-agent: {user_agent(args.town)}")
    for r in reports:
        print(r.line())
    failed = bool(problems) or any(r.error for r in reports)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
