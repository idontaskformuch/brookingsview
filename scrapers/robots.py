"""robots.txt verdicts (RFC 9309 semantics) for every pipeline that fetches a third-party page.

`standard` (default): pick the group that names our product token (`ViewMediaBot`), else the `*` group, and test the URL path against that
group's rules (longest matching pattern wins, Allow wins a tie, `*` and trailing `$` work in patterns). Other crawlers being named, AI
crawlers included, says nothing about us and gives no verdict.
`strict` (opt-in per source, e.g. `robots_mode: "strict"` in a sports source; always used by the evening register by owner decision
2026-10-28): standard, plus the source is excluded when its robots.txt names an AI crawler anywhere.

An unreachable robots.txt, 401/403/5xx is a no (never worked around, CLAUDE.md rule 13); 404 = no robots.txt = allowed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from scrapers.user_agent import BOT_NAME

AI_BOT_TOKENS = ("gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-searchbot", "claude-user", "anthropic-ai",
                 "ccbot", "google-extended", "perplexitybot", "bytespider", "cohere-ai")
MODES = ("standard", "strict")
DEFAULT_MODE = "standard"


@dataclass
class Verdict:
    ok: bool
    reason: str = ""
    crawl_delay: float | None = None


@dataclass
class _Group:
    agents: list[str] = field(default_factory=list)
    rules: list[tuple[bool, str]] = field(default_factory=list)  # (allow, path pattern)
    delay: float | None = None


def _groups(text: str) -> list[_Group]:
    groups: list[_Group] = []
    cur: _Group | None = None
    in_rules = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (p.strip() for p in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if cur is None or in_rules:
                cur = _Group()
                groups.append(cur)
                in_rules = False
            cur.agents.append(value.lower())
        elif key in ("allow", "disallow", "crawl-delay") and cur is not None:
            in_rules = True
            if key == "crawl-delay":
                try:
                    cur.delay = float(value)
                except ValueError:
                    pass
            elif value:  # an empty Disallow allows everything and an empty Allow changes nothing
                cur.rules.append((key == "allow", value))
    return groups


def _select(groups: list[_Group], token: str) -> list[_Group]:
    named = [g for g in groups if token in g.agents]
    return named or [g for g in groups if "*" in g.agents]


def _pattern(path_pattern: str) -> re.Pattern[str]:
    anchored = path_pattern.endswith("$")
    body = path_pattern[:-1] if anchored else path_pattern
    return re.compile("".join(".*" if c == "*" else re.escape(c) for c in body) + ("$" if anchored else ""))


def _allowed(rules: list[tuple[bool, str]], target: str) -> bool:
    best: tuple[int, bool] | None = None  # (pattern length, allow)
    for allow, pat in rules:
        if _pattern(pat).match(target):
            cand = (len(pat), allow)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                best = cand
    return True if best is None else best[1]


def crawl_delay(text: str, token: str = BOT_NAME) -> float | None:
    """Crawl-delay of the group that applies to `token` (its own group, else `*`)."""
    for g in _select(_groups(text or ""), token.lower()):
        if g.delay is not None:
            return g.delay
    return None


def verdict(status: int | None, text: str | None, url: str, *, mode: str = DEFAULT_MODE, token: str = BOT_NAME) -> Verdict:
    """`status` None = no answer at all (timeout, DNS)."""
    if mode not in MODES:
        raise ValueError(f"robots mode {mode!r}: expected one of {', '.join(MODES)}")
    if status is None:
        return Verdict(False, "robots.txt unreachable (no answer): skipped")
    if status == 404:
        return Verdict(True, "no robots.txt (404)")
    if status != 200:
        return Verdict(False, f"robots.txt answered {status}: skipped")
    body = text or ""
    groups = _groups(body)
    if mode == "strict":
        for g in groups:
            hit = next((a for a in g.agents if any(b in a for b in AI_BOT_TOKENS)), None)
            if hit:
                return Verdict(False, f"robots.txt names the AI crawler {hit} (strict mode)")
    parts = urlparse(url)
    target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    selected = _select(groups, token.lower())
    delay = next((g.delay for g in selected if g.delay is not None), None)
    if not _allowed([r for g in selected for r in g.rules], target):
        return Verdict(False, f"robots.txt disallows {parts.path or '/'} for {token}", delay)
    return Verdict(True, "robots.txt ok", delay)
