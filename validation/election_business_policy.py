"""Phase 0 check 6: election/candidate/ballot-measure endorsements, and
named-private-party criticism.

Added 2026-10-01 after a live incident (not hypothetical): one Brookings
editorial took an explicit position on a live ballot measure ("the council
should vote this resolution down... voters should ask why a limit on power
needed loosening"), and a separate editorial named and criticized a real
local business (framed as "a warning") with no sourcing for its central
claims. Both were caught only by a human review after publication -- this
is the automated gate that should have caught them before.

Originally added directly to content/kronikor/editorial.py's own system
prompt (prevention only). Moved here, 2026-10-01, into the SAME shared
gate every content track already passes through -- content/_base.py's
generate_article() calls pre_publish_check() for every one of editorial,
culture_essay, kvick_essa, vetenskap_kronika, media_recension, and
vardagsmiddag, so wiring this check in here (not per-module) means no
content type can forget it, including ones added later. The editorial
prompt's own instruction stays too (prevention is cheaper than a retry),
but this is the enforcement that doesn't depend on the model following it.

ALLOWED: factual description of civic processes, elections, and ballot
measures as TOPICS -- what's on the ballot, when, the mechanics, the
stakes, who it affects -- without taking a position on how to vote and
without naming a private party as the direct subject of criticism. This
mirrors content/kronikor/editorial.py's own system-prompt rule; this module
is the deterministic enforcement of it, not a restatement.

FORBIDDEN, always:
  1. Endorsing or opposing a candidate, ballot measure, or referendum
     ("voters should reject this", "the council should vote this down",
     "doesn't deserve your vote", etc.).
  2. Naming a private business or person as the direct target of
     criticism.

Same philosophy as review_standard.py / ai_pipeline.town_guard.has_local_anchor():
transparent regex/keyword matching, never a second AI judgment call on the
model's own output. Check 2 in particular is deliberately imprecise where
precision is genuinely hard (see _named_target_violations()'s own comment)
-- same "deliberately permissive" tradeoff this codebase already accepts
elsewhere (e.g. review_standard.py's plot-summary-ratio): a false positive
here costs one retry (generate_article()'s existing retry-once-then-skip
pattern), never a wrongly-published piece.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ElectionBusinessPolicyResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# Phrases that take an explicit position on how to vote, or urge one.
# Scoped to a sentence that ALSO contains an election/ballot-measure stake
# word (see _ELECTION_STAKE_WORDS below), so an unrelated "the council
# should vote" (e.g. on a routine zoning permit, which is allowed civic
# process critique) doesn't trip this -- only a vote tied to an actual
# electoral stake does.
_ENDORSEMENT_PHRASES = re.compile(
    r"voters? should (?:reject|approve|support|oppose|vote)|"
    r"should vote (?:\w+\s+){0,3}?(?:down|up|yes|no)\b|"
    r"\bvote (?:yes|no) on\b|"
    r"\bvote (?:for|against) (?:this|that|the)\b|"
    r"(?:council|commissioners?|board) should (?:decline|reject|refuse)|"
    r"doesn'?t deserve (?:your|our|a) vote|"
    r"deserves (?:your|our) vote",
    re.IGNORECASE,
)
_ELECTION_STAKE_WORDS = re.compile(
    r"\b(ballot|referendum|measure|resolution|term limits?|candidate|"
    r"election|incumbent|re-?election|primary)\b", re.IGNORECASE,
)


def _endorsement_violations(text: str) -> list[str]:
    violations = []
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        if _ENDORSEMENT_PHRASES.search(sentence) and _ELECTION_STAKE_WORDS.search(sentence):
            violations.append(
                f"takes an explicit position on an election/ballot matter: {sentence.strip()[:160]!r}"
            )
    return violations


# Civic/government/institutional words a criticized proper-noun span is
# allowed to contain -- these are legitimate accountability-journalism
# targets; a private business or person is not. Matched case-insensitively
# against each word in the span.
_CIVIC_ALLOWLIST_WORDS = {
    "council", "commission", "committee", "county", "city", "district",
    "department", "board", "office", "authority", "agency", "administration",
    "school", "library", "university", "college", "state", "federal",
    "government", "police", "fire", "court", "judge", "attorney",
    "commissioners", "legislature", "senate", "house", "township",
}
#  Deliberately narrow/high-precision, not a broad vocabulary list: a real
# scan of everything currently published (2026-10-01) found "warning",
# "deceptive", "exploit", and "scheme" all have common, entirely neutral
# uses in this site's own civic/weather/science writing ("a Heat Advisory,
# warning that the heat index would climb...", "deceptively brutal"
# describing weather, a disclaimer "like a warning label") that have
# nothing to do with criticizing a private party. Each phrase below is
# multi-word and specific enough that a legitimate, unrelated use is very
# unlikely -- favoring false negatives over false positives, the same
# "deliberately permissive" tradeoff this codebase already accepts
# elsewhere (see module docstring).
_CRITICAL_MARKERS = (
    "should read as a warning", "is a warning sign about",
    "should be ashamed of", "shouldn't be trusted", "should not be trusted",
    "is a scam", "is predatory", "ought to answer for", "should answer for",
)
# A capitalized multi-word span (2-4 Title-Case words) -- a rough proxy for
# "this reads like a proper noun / named entity." NOT real named-entity
# recognition: this is a deliberate, disclosed limitation (see module
# docstring) rather than a second AI call to judge the model's own output.
_PROPER_NOUN_SPAN_RE = re.compile(
    r"\b([A-Z][a-zA-Z]+(?:['’][A-Za-z]+)?(?:\s+[A-Z][a-zA-Z]+){1,3})\b"
)


#  A named target and its critical framing are often a sentence or two
# apart in real prose (e.g. "X will open its new office... This is the
# warning sign Brookings should read" -- the real, live example this check
# exists for), so this looks within a character window around each
# critical-language hit rather than requiring both in the SAME sentence.
_NAMED_TARGET_WINDOW_CHARS = 250


def _named_target_violations(text: str) -> list[str]:
    seen: set[tuple[str, str]] = set()
    violations = []
    for marker in _CRITICAL_MARKERS:
        for marker_match in re.finditer(re.escape(marker), text, re.IGNORECASE):
            window = text[
                max(0, marker_match.start() - _NAMED_TARGET_WINDOW_CHARS):
                marker_match.end() + _NAMED_TARGET_WINDOW_CHARS
            ]
            for span_match in _PROPER_NOUN_SPAN_RE.finditer(window):
                span = span_match.group(1)
                words = span.split()
                if any(w.lower() in _CIVIC_ALLOWLIST_WORDS for w in words):
                    continue
                key = (span, marker)
                if key in seen:
                    continue
                seen.add(key)
                violations.append(f"names {span!r} near critical language {marker!r}")
    return violations


def check_election_business_policy(text: str) -> ElectionBusinessPolicyResult:
    violations = _endorsement_violations(text) + _named_target_violations(text)
    return ElectionBusinessPolicyResult(passed=len(violations) == 0, violations=violations)
