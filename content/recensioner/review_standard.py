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

import datetime
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


_MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
_SEASON_MONTHS = {
    "winter": (12, 1, 2), "spring": (3, 4, 5), "summer": (6, 7, 8),
    "fall": (9, 10, 11), "autumn": (9, 10, 11),
}
_MONTH_OR_SEASON_WORDS = set(_MONTH_NAMES) | set(_SEASON_MONTHS)
# Case-SENSITIVE, requiring an initial capital: "may" (modal verb) and "fall"
# ("to fall", "fall in love") are common English words that only collide with
# the month/season names when lowercase mid-sentence -- confirmed live
# against real published reviews. A real month/season reference is a proper
# noun and capitalized regardless of sentence position ("this July", "next
# July"), so requiring the capital costs nothing real while cutting the
# false-positive rate to near zero.
_MONTH_OR_SEASON_RE = re.compile(r"\b([A-Z][a-z]+)\b")
# A month/season word within this many chars of one of these is almost
# certainly describing WHEN THE FILM ITSELF came out, not the current
# season -- a legitimate, factual reference this check must not flag. A
# bare 4-digit year nearby is included because a dated reference ("July
# 2019") is unambiguously historical regardless of which verb is used.
_RELEASE_CONTEXT_RE = re.compile(
    r"(released?|premier(?:e|ed)?|debut(?:ed)?|came out|opened( in)?|"
    r"hits? theaters|hit theaters|originally|anniversary|first (?:aired|ran)|"
    r"\b(19|20)\d{2}\b)",
    re.IGNORECASE,
)
_CONTEXT_WINDOW = 45


def _season_month_conflicts(body: str, publish_date: datetime.date) -> list[str]:
    """Non-negotiable per the Sep 30 2026 season-bug fix (a review published
    in September described "late July" as the current season, because
    nothing told the model today's actual date and it anchored on the
    film's own release-date context instead). Deterministic, no LLM call:
    flag any month name or season word that conflicts with publish_date's
    real month, UNLESS it sits next to language that marks it as describing
    the work's own release date rather than "right now"."""
    conflicts: list[str] = []
    for m in _MONTH_OR_SEASON_RE.finditer(body):
        word = m.group(1).lower()
        if word not in _MONTH_OR_SEASON_WORDS:
            continue
        if word in _SEASON_MONTHS:
            if publish_date.month in _SEASON_MONTHS[word]:
                continue
        else:
            month_num = _MONTH_NAMES.index(word) + 1
            if month_num == publish_date.month:
                continue
        window = body[max(0, m.start() - _CONTEXT_WINDOW): m.end() + _CONTEXT_WINDOW]
        if _RELEASE_CONTEXT_RE.search(window):
            continue
        conflicts.append(
            f'"{m.group(0)}" reads as the current season/month, but this is publishing in '
            f'{_MONTH_NAMES[publish_date.month - 1].title()} {publish_date.year}'
        )
    return conflicts


def _plot_summary_ratio(body: str) -> float:
    sentences = _SENTENCE_SPLIT_RE.split(body)
    total_words = sum(len(s.split()) for s in sentences) or 1
    plot_words = sum(len(s.split()) for s in sentences
                      if any(m in s.lower() for m in _PLOT_MARKERS))
    return plot_words / total_words


def check_review_standard(title: str, body: str, cfg: dict | None,
                           venue_names: list[str], has_review_scores: bool,
                           publish_date: datetime.date | None = None) -> ReviewCheckResult:
    """Structural check against the five non-negotiables (see
    NEEDS-HUMAN-REVIEW.md "Review Writing Standard"). Non-negotiable #5
    (disclosure + verification date) isn't checked here -- write() appends
    that line itself rather than trusting the model with today's date, so
    there's nothing probabilistic left to verify.

    publish_date is optional (defaults to skipping the season/month check
    entirely, not to today's date) so existing callers -- and the many
    exact-signature tests this module already had before the 2026-09-30
    season-bug fix -- don't silently start applying a check they never
    asked for."""
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

    if publish_date is not None:
        violations.extend(_season_month_conflicts(body, publish_date))

    return ReviewCheckResult(passed=len(violations) == 0, violations=violations)
