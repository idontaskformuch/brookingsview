"""Deterministic pre-publish checks for media_recension against the Review
Writing Standard (see NEEDS-HUMAN-REVIEW.md "Review Writing Standard").

Same philosophy as ai_pipeline/town_guard.py's has_local_anchor()/
validate_town_identity(): transparent keyword/regex matching, never an AI
judgment call about its own output. Unlike those two (which gate a hard
retry-then-skip), this is retry-then-FLAG -- see media_recension.write().
These are among the site's highest-effort pieces, and a false positive (a
genuinely all-positive reception with no real dissent to show, an unusual
but valid structure) shouldn't cost a good review its publication, only a
human's five-minute look at review_quality_flags.

Deliberately permissive throughout, same tradeoff has_local_anchor() makes:
a false negative just costs one retry with an explicit correction, not a
wrongly-blocked (or here, wrongly-flagged) review.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_PARA_SPLIT_RE = re.compile(r"\n\s*\n")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

_CONTRAST_MARKERS = (
    "but ", "but,", "however", "while ", "though ", "on the other hand",
    "not everyone", "not all critics", "some found", "others found",
    "by contrast", "still,", "that said", "even so",
)
_VERDICT_MARKERS = (
    "the verdict", "my read", "bottom line", "worth your time", "worth the",
    "skip it", "recommend", "stands as", "is worth", "isn't worth",
    "worth seeing", "worth a watch", "in the end,", "all told,",
)
# A coarse proxy for "the premise gets one tight section, not the whole
# piece" -- NOT a real plot-summary detector (that would need actual
# understanding of the text), just sentence-opener keywords a plot recap
# tends to use. Documented limitation: a review that happens to use these
# words in its angle/verdict sections too will read as more plot-heavy than
# it is. Flag threshold is intentionally generous (>50%, matching the brief)
# so this only catches genuinely plot-dominated drafts.
_PLOT_MARKERS = (
    "follows", "centers on", "centers around", "the story of", "we meet",
    "opens with", "picks up with", "sets out to", "tells the story",
)


@dataclass
class ReviewCheckResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


def _first_paragraph(body: str) -> str:
    paras = _PARA_SPLIT_RE.split(body.strip())
    return paras[0] if paras else body


def _has_local_open(title: str, body: str, town_display_name: str | None,
                     venue_names: list[str]) -> bool:
    lede = f"{title}\n{_first_paragraph(body)}".lower()
    if town_display_name and town_display_name.lower() in lede:
        return True
    return any(v.lower() in lede for v in venue_names)


def _has_named_venue(body: str, venue_names: list[str]) -> bool:
    # No registered theaters for this town yet -- nothing to verify a name
    # against, so this check can't meaningfully fail (see
    # site/src/lib/site-config.ts's localTheaters being optional per-town).
    if not venue_names:
        return True
    low = body.lower()
    return any(v.lower() in low for v in venue_names)


def _plot_summary_ratio(body: str) -> float:
    sentences = _SENTENCE_SPLIT_RE.split(body)
    total_words = sum(len(s.split()) for s in sentences) or 1
    plot_words = sum(len(s.split()) for s in sentences
                      if any(m in s.lower() for m in _PLOT_MARKERS))
    return plot_words / total_words


def check_review_standard(title: str, body: str, cfg: dict | None,
                           venue_names: list[str], has_review_scores: bool) -> ReviewCheckResult:
    """Structural check against the five non-negotiables (see
    NEEDS-HUMAN-REVIEW.md "Review Writing Standard"). Non-negotiable #5
    (disclosure + verification date) isn't checked here -- write() appends
    that line itself rather than trusting the model with today's date, so
    there's nothing probabilistic left to verify."""
    cfg = cfg or {}
    violations: list[str] = []

    if not _has_local_open(title, body, cfg.get("display_name"), venue_names):
        violations.append("no local hook (town name or a named local venue) in the headline/opening paragraph")

    if not _has_named_venue(body, venue_names):
        violations.append("no verified local venue named anywhere in the review")

    low = body.lower()
    if has_review_scores and not any(m in low for m in _CONTRAST_MARKERS):
        violations.append("no contrast/dissent language found despite real divided-reception data being provided")
    if not any(m in low for m in _VERDICT_MARKERS):
        violations.append("no clear verdict sentence found")

    ratio = _plot_summary_ratio(body)
    if ratio > 0.5:
        violations.append(f"plot-summary-heavy ({ratio:.0%} of body reads as plot narration) -- missing an angle")

    return ReviewCheckResult(passed=len(violations) == 0, violations=violations)
