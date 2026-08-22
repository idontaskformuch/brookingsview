"""Cross-site (Brookings <-> Moreno Valley) contamination guard.

Root cause of the July-August 2026 incident: content/kronikor/*.py,
content/recensioner/media_recension.py, and content/recept/vardagsmiddag.py
each had "Brookings, South Dakota" hardcoded directly into their
SYSTEM_PROMPT string, regardless of which --config was passed -- cfg reached
these modules but was never used to build the prompt text itself. Fixed in
a5ebec0 + e108341 (2026-08-07), which introduced content/_base.py's
town_label(cfg) helper. THIS MODULE IS THE STRUCTURAL FOLLOW-UP: even with
the specific cause fixed, nothing previously checked generated text for the
wrong town's identity, so the same class of bug (a future prompt template
change, a copy-pasted module, a config mixup) could silently recur with no
guardrail catching it. This is that guardrail.

Shared by:
  - content/_base.py:generate_article() -- live pre-publish gate. A hard-tier
    match means the draft does not get published, full stop -- see that
    module for the retry-then-skip behavior.
  - scripts/scan_contamination.py -- retroactive, read-only scan of already-
    published `stories` rows. Produces a report; never unpublishes anything
    itself. A human makes that call, per the audit brief.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class GuardrailResult:
    passed: bool
    violations: list[str] = field(default_factory=list)
    # Vanliga nog för falska positiva att inte blockera på egen hand (se
    # REVIEW_BLOCKLIST), men värda att logga/rapportera för mänsklig koll.
    reviews: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


# Hård karantän: en träff här ska ALDRIG publiceras för den här orten.
# Ordagrant hämtat ur redaktionsgranskningens brief (augusti 2026).
HARD_BLOCKLIST: dict[str, list[str]] = {
    "moreno_valley_ca": [
        "Brookings", "South Dakota", "SDSU", "South Dakota State", "Highway 14",
        "De Smet", "Volga", "Elkton", "605 area code", "eastern Dakotas",
    ],
    "brookings_sd": [
        "Moreno Valley", "Inland Empire", "Riverside County", "Alessandro",
        "Perris Blvd", "MoVal", "951",
    ],
}

# Granska, blockera inte: vanliga nog som vanliga engelska ord/gatunamn att
# en hård spärr skulle kosta mer i onödiga omgenereringar än den förhindrar
# (t.ex. "prairie" som metafor, "Sixth Street" som finns i många städer).
REVIEW_BLOCKLIST: dict[str, list[str]] = {
    "moreno_valley_ca": ["prairie", "Sixth Street"],
    "brookings_sd": [],
}

ALL_TOWN_IDS = list(HARD_BLOCKLIST.keys())

# "Adresserad läsare"-markörer, för skannerns rapport (INTE för den live
# porten -- den blockerar redan på vilken hård träff som helst). Brief-regel
# 3: att NÄMNA andra orten som utomstående exempel är okej, att TILLTALA den
# som hemmaplan är det inte. En träff som delar mening med en av dessa
# markörer eskaleras i rapporten mot "rewrite locally" i stället för
# "false positive" -- en människa gör fortfarande det slutgiltiga valet.
ADDRESSED_READER_MARKERS = [
    "here in", "our own", "readers in the", "right here", "we're", "we are",
    "this matters for",
]

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _word_boundary_pattern(term: str) -> re.Pattern:
    return re.compile(r"\b" + re.escape(term) + r"\b", re.IGNORECASE)


def _find_matches(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if _word_boundary_pattern(term).search(text)]


def validate_town_identity(text: str, town_id: str) -> GuardrailResult:
    """Does `text` (written FOR `town_id`) leak the other town's identity?

    Hard-blocklist hits fail (no publish, see content/_base.py). Review-tier
    hits are reported but never block generation on their own.
    """
    hard_terms = HARD_BLOCKLIST.get(town_id, [])
    review_terms = REVIEW_BLOCKLIST.get(town_id, [])

    hard_hits = _find_matches(text, hard_terms)
    review_hits = _find_matches(text, review_terms)

    violations = [f"blocked term for {town_id}: {t}" for t in hard_hits]
    reviews = [f"review term for {town_id}: {t}" for t in review_hits]

    return GuardrailResult(passed=len(violations) == 0, violations=violations, reviews=reviews)


def addressed_reader_hits(text: str, matched_terms: list[str]) -> list[str]:
    """Which of `matched_terms` appear in a sentence that ALSO contains a
    first-person-locality marker? Used only by the retroactive scanner to
    pre-sort quarantine items -- see module docstring, rule 3."""
    escalated: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        low = sentence.casefold()
        if not any(marker in low for marker in ADDRESSED_READER_MARKERS):
            continue
        for term in matched_terms:
            if term not in escalated and _word_boundary_pattern(term).search(sentence):
                escalated.append(term)
    return escalated
