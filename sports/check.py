"""Dry-run every configured sports source for a town: reachable, robots OK, event count, date range, sports found. Writes nothing.

    python -m sports.check --town broomfield_co
    python -m sports.check --validate-all        # config validation only, for every town (exit 1 on any problem)

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

from scrapers.evening_register import robots_verdict
from scrapers.user_agent import user_agent
from sports import adapters
from sports.config import validate_sports_config
from sports.models import NormalizedEvent, NormalizedStanding

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"
MAX_CRAWL_DELAY_SECONDS = 10


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

    def line(self) -> str:
        robots = "n/a" if self.robots_ok is None else ("ok" if self.robots_ok else f"BLOCKED ({self.robots_note})")
        if self.error:
            return f"{self.label}: reachable={'yes' if self.reachable else 'no'} robots={robots} ERROR {self.error}"
        span = f"{self.first}..{self.last}" if self.first else "-"
        return (f"{self.label}: reachable=yes robots={robots} events={self.events} standings={self.standings} "
                f"range={span} sports={','.join(self.sports) or '-'}")


def crawl_delay(robots_text: str) -> float | None:
    """Crawl-delay of the `*` group, if any."""
    in_star = False
    for raw in robots_text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (p.strip() for p in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            in_star = value == "*"
        elif key == "crawl-delay" and in_star:
            try:
                return float(value)
            except ValueError:
                return None
    return None


def _http_get(url: str, ua: str):
    import requests
    try:
        res = requests.get(url, headers={"User-Agent": ua}, timeout=20)
        return res.status_code, res.text
    except requests.RequestException:
        return None, ""


def check_source(source: dict, town_id: str, *, get=_http_get, sleep=time.sleep) -> SourceReport:
    name = source.get("adapter", "?")
    label = f"{name}" + (f" [{source['program']}/{source.get('sport', '*')}]" if source.get("program") else "")
    report = SourceReport(label=label)
    params = adapters.merged_params(source)
    url = params.get("url")
    ua = user_agent(town_id)
    if url:
        parts = urlparse(url)
        status, text = get(f"{parts.scheme}://{parts.netloc}/robots.txt", ua)
        verdict = robots_verdict(status, text, url)
        report.robots_ok, report.robots_note = verdict.ok, verdict.reason
        if not verdict.ok:
            report.error = "skipped, adapter not called"
            return report
        delay = crawl_delay(text or "")
        if delay:
            sleep(min(delay, MAX_CRAWL_DELAY_SECONDS))
    try:
        rows = adapters.get(name)(params)
    except Exception as exc:  # a dry run reports every failure instead of stopping
        report.error = f"{type(exc).__name__}: {exc}"[:200]
        return report
    report.reachable = True
    events = [r for r in rows if isinstance(r, NormalizedEvent)]
    report.events = len(events)
    report.standings = sum(isinstance(r, NormalizedStanding) for r in rows)
    if events:
        stamps = sorted(e.start_at for e in events)
        report.first, report.last = stamps[0].date().isoformat(), stamps[-1].date().isoformat()
        report.sports = sorted({e.sport for e in events})
    return report


def check_town(cfg: dict, *, get=_http_get, sleep=time.sleep) -> tuple[list[str], list[SourceReport]]:
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
    for r in reports:
        print(r.line())
    failed = bool(problems) or any(r.error for r in reports)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
