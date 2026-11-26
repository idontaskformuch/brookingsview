"""robots.txt verdicts (RFC 9309 semantics) for every pipeline that fetches a third-party page.

One mode for the whole codebase (owner 2026-11-18; the old opt-in `strict` mode is gone): pick the group that names our product token
(`ViewMediaBot`), else the `*` group, and test the URL path against that group's rules (longest matching pattern wins, Allow wins a tie,
`*` and trailing `$` work in patterns). A Disallow in that group is a no; Crawl-delay is respected (polite_fetch).
When the URL is allowed for us but an AI crawler's own group DISALLOWS its path, the URL is `llm_excluded` (owner 2026-11-18): its
structured facts (title, time, place, link) may be used, its content must NEVER go through a language model. Merely naming an AI crawler
is not enough (downtownbrookings.com names them all with the same rules as `*`). polite_fetch carries the mark, with the bot and the rule,
on every Fetched and in the fetch log; the evening register refuses to send such a page to its model.

An unreachable robots.txt, 401/403/5xx is a no (never worked around, CLAUDE.md rule 13); 404 = no robots.txt = allowed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from scrapers.user_agent import BOT_NAME

AI_BOT_TOKENS = ("gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-searchbot", "claude-user", "anthropic-ai",
                 "ccbot", "google-extended", "perplexitybot", "bytespider", "cohere-ai")


@dataclass
class Verdict:
    ok: bool
    reason: str = ""
    crawl_delay: float | None = None
    # The AI crawler whose own group disallows this URL's path (lower case), and that group's deciding rule ("Disallow: /events/").
    # Set even when `ok`: this URL's content must never reach a model. None when no AI crawler's group disallows the path.
    ai_bot: str | None = None
    ai_rule: str | None = None

    @property
    def llm_excluded(self) -> bool:
        return self.ai_bot is not None


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


def _pattern(path_pattern: str, ignore_case: bool = False) -> re.Pattern[str]:
    anchored = path_pattern.endswith("$")
    body = path_pattern[:-1] if anchored else path_pattern
    return re.compile("".join(".*" if c == "*" else re.escape(c) for c in body) + ("$" if anchored else ""),
                      re.IGNORECASE if ignore_case else 0)


def _deciding(rules: list[tuple[bool, str]], target: str) -> tuple[bool, str] | None:
    """The rule that decides `target` (longest match, Allow wins a tie): (allow, pattern), or None when no rule matches."""
    best: tuple[int, bool, str] | None = None  # (pattern length, allow, pattern)
    # STRICTER than RFC 9309 (owner 2026-11-26): a Disallow applies whatever the case of its path, so "Disallow: /common/modules/icalendar/"
    # (broomfield.org) also covers /common/modules/iCalendar/. An Allow still matches exactly as written, so this can only ever block
    # more, never open a path that was closed.
    for allow, pat in rules:
        if _pattern(pat, ignore_case=not allow).match(target):
            cand = (len(pat), allow, pat)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                best = cand
    return None if best is None else (best[1], best[2])


def _allowed(rules: list[tuple[bool, str]], target: str) -> bool:
    d = _deciding(rules, target)
    return True if d is None else d[0]


def _target(url: str) -> str:
    parts = urlparse(url)
    return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


def crawl_delay(text: str, token: str = BOT_NAME) -> float | None:
    """Crawl-delay of the group that applies to `token` (its own group, else `*`)."""
    for g in _select(_groups(text or ""), token.lower()):
        if g.delay is not None:
            return g.delay
    return None


def ai_disallowed(text: str | None, url: str) -> tuple[str, str] | None:
    """(AI crawler token, deciding rule) when an AI crawler's own group in this robots.txt disallows `url`'s path, else None.
    Groups are read as RFC 9309 says a crawler reads them: the group(s) naming that crawler, not `*`."""
    target = _target(url)
    for g in _groups(text or ""):
        for agent in g.agents:
            if not any(b in agent for b in AI_BOT_TOKENS):
                continue
            d = _deciding(g.rules, target)
            if d is not None and not d[0]:
                return agent, f"Disallow: {d[1]}"
    return None


def names_ai_bot(text: str | None) -> str | None:
    """The first AI crawler a robots.txt names in any user-agent line, else None. This was the old strict mode's whole test
    ("names an AI crawler -> no", removed 2026-11-18); it decides nothing now and is only reported (the discovery pilot's
    "would have been refused under the old strict mode" column)."""
    for g in _groups(text or ""):
        hit = next((a for a in g.agents if any(b in a for b in AI_BOT_TOKENS)), None)
        if hit:
            return hit
    return None


def verdict(status: int | None, text: str | None, url: str, *, token: str = BOT_NAME) -> Verdict:
    """`status` None = no answer at all (timeout, DNS)."""
    if status is None:
        return Verdict(False, "robots.txt unreachable (no answer): skipped")
    if status == 404:
        return Verdict(True, "no robots.txt (404)")
    if status != 200:
        return Verdict(False, f"robots.txt answered {status}: skipped")
    body = text or ""
    groups = _groups(body)
    hit = ai_disallowed(body, url)
    ai_bot, ai_rule = hit if hit else (None, None)
    parts = urlparse(url)
    target = _target(url)
    selected = _select(groups, token.lower())
    delay = next((g.delay for g in selected if g.delay is not None), None)
    if not _allowed([r for g in selected for r in g.rules], target):
        return Verdict(False, f"robots.txt disallows {parts.path or '/'} for {token}", delay, ai_bot, ai_rule)
    return Verdict(True, "robots.txt ok" + (f" ({ai_bot}: {ai_rule}, llm_excluded)" if ai_bot else ""), delay, ai_bot, ai_rule)
