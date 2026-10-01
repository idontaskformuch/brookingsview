"""Phase 0 check 7: unsourced local-showtime / "now playing" / theater-
availability claims in film & TV reviews.

Added 2026-10-01 per an explicit instruction: this site's media_recension
pipeline (content/now_playing.py) has NO source anywhere for actual current
showtimes or confirmed present-day theater availability. build_local_input()
pulls Wikidata (release date, aggregate critic scores) and Wikipedia
(summary), plus cfg["local_theaters"] -- a REAL, verified theater name/
address/phone, so the theater's existence is a fact -- but nothing in this
pipeline confirms THIS title is playing at THAT theater THIS week. Reviews
have nonetheless been asserting exactly that across all three towns (e.g.
"...and Brookings Cinema 8 Has It on the Big Screen This Weekend", "Moreno
Valley gets first crack at it this weekend", "Broomfield Still Has Time to
Catch It") -- see the 2026-10-01 cleanup round's audit of all 18 published
reviews, which is what calibrated the phrases below.

Scoped to content_type == "media_recension" only, via the content_type
parameter below -- this is the only content track that makes these claims.
Kept self-contained and independently testable like every other Phase 0
check (see pre_publish_check.py), rather than silently global.

Naming a real local theater is NOT itself a violation (non-negotiable #6,
review_standard.py's _has_named_venue()) -- the theater existing is a
verified fact. What's unverifiable is CURRENT/temporal exhibition status:
"now playing", "playing this weekend", "showtimes", "still in theaters",
etc. -- none of which this pipeline has data for. Same "deliberately
permissive" philosophy as election_business_policy.py: narrow, specific
phrases calibrated against real published text, favoring false negatives
over false positives (a false positive here costs one retry, same as every
other Phase 0 check's tradeoff).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class UnverifiableAvailabilityResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


# Direct, unambiguous claims of current exhibition/availability status --
# none of these can ever be true-by-data in this pipeline (no showtime
# source exists at all), so any occurrence is a violation regardless of
# surrounding context.
_DIRECT_AVAILABILITY_PHRASES = (
    "now playing", "now showing", "playing now", "showing now",
    "currently playing", "currently showing",
    "still playing", "still in theaters", "still in theatres",
    "check local showtimes", "check showtimes", "showtimes", "show times",
    "buy tickets", "tickets are available", "get your tickets",
    "in theaters now", "in theatres now",
    "playing in theaters", "playing in theatres",
    # These read as present-tense/priority-access claims on their own, with
    # no need for a nearby "this week(end)" to make the claim -- calibrated
    # against real published headlines (module docstring): "...Has It on the
    # Big Screen This Weekend", "...is the cheapest way to see it",
    # "Broomfield Still Has Time to Catch It", "...Gets First Crack at It".
    "has it on the big screen", "cheapest way to see it",
    "still has time to catch", "first crack at it",
    "gets its shot at the big screen",
)

# "this week"/"this weekend" alone is a harmless time reference (and the
# model's own release-date-vs-season confusion is a SEPARATE, already-fixed
# bug -- see review_standard.py's _season_month_conflicts()). It only
# becomes an unsourced availability claim when paired, nearby, with
# theater-going/access language -- calibrated against the real phrasings in
# all 18 reviews published across the 3 towns as of 2026-10-01 (module
# docstring).
_TEMPORAL_WORDS_RE = re.compile(r"\bthis (?:weekend|week)\b", re.IGNORECASE)
_AVAILABILITY_CONTEXT_PHRASES = (
    "catch it", "catch the", "see it", "watch it", "big screen",
    "multiplex", "the theater", "the theatre", "on screen",
    "lands in", "swings into", "swings back", "celebrate at",
    "drive far to see", "gets its lane",
)
_AVAILABILITY_WINDOW_CHARS = 60


def _direct_violations(text: str) -> list[str]:
    low = text.lower()
    return [f"unsourced availability claim: {phrase!r}"
            for phrase in _DIRECT_AVAILABILITY_PHRASES if phrase in low]


def _temporal_context_violations(text: str) -> list[str]:
    low = text.lower()
    violations = []
    for match in _TEMPORAL_WORDS_RE.finditer(text):
        window = low[max(0, match.start() - _AVAILABILITY_WINDOW_CHARS):
                      match.end() + _AVAILABILITY_WINDOW_CHARS]
        for marker in _AVAILABILITY_CONTEXT_PHRASES:
            if marker in window:
                violations.append(
                    f"{match.group(0)!r} reads as a current-availability claim near {marker!r}"
                )
                break
    return violations


def check_unverifiable_availability(
    text: str, content_type: str | None
) -> UnverifiableAvailabilityResult:
    """No-op (passed=True) for every content_type except media_recension --
    the only track this pipeline writes showtime/availability-shaped claims
    for at all."""
    if content_type != "media_recension":
        return UnverifiableAvailabilityResult(passed=True)
    violations = _direct_violations(text) + _temporal_context_violations(text)
    return UnverifiableAvailabilityResult(passed=len(violations) == 0, violations=violations)
