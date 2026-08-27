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
        "Broomfield", "Adams 12", "Boulder Valley", "Interlocken", "Flatirons",
    ],
    "brookings_sd": [
        "Moreno Valley", "Inland Empire", "Riverside County", "Alessandro",
        "Perris Blvd", "MoVal", "951",
        "Broomfield", "Adams 12", "Boulder Valley", "Interlocken", "Flatirons",
    ],
    # Broomfield launch (2026-08-26): both directions matter equally here --
    # this list guards Broomfield content against the OTHER two towns'
    # identity leaking in, but Brookings/moreno_valley_ca's own lists above
    # also needed Broomfield-specific terms added, or a copy-paste leak of
    # "Broomfield"/"Interlocken" into THEIR content would have gone
    # undetected by their own guards (see module docstring -- this is a
    # bidirectional guard, not one town's problem to fix alone).
    "broomfield_co": [
        "Brookings", "South Dakota", "SDSU", "South Dakota State",
        "Moreno Valley", "Inland Empire", "Riverside County", "MoVal",
    ],
}

# Granska, blockera inte: vanliga nog som vanliga engelska ord/gatunamn att
# en hård spärr skulle kosta mer i onödiga omgenereringar än den förhindrar
# (t.ex. "prairie" som metafor, "Sixth Street" som finns i många städer).
REVIEW_BLOCKLIST: dict[str, list[str]] = {
    "moreno_valley_ca": ["prairie", "Sixth Street"],
    "brookings_sd": [],
    "broomfield_co": [],
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


# A concrete, checkable local specific -- the OPPOSITE direction from
# HARD_BLOCKLIST above (that guards against the wrong town's identity
# leaking in; this guards against NO town's identity being present at all,
# a location-less think-piece that could run on any site). Added 2026-08-23
# for columns/editorials, see NEEDS-HUMAN-REVIEW.md "3.5 Columns &
# Editorials". Deterministic keyword/regex matching, same philosophy as
# is_closure()/is_suspicious() elsewhere in this codebase -- transparent and
# auditable, not an AI judgment call about its own output.
_STREET_ANCHOR_RE = re.compile(
    r"\b[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2}\s"
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Circle|Cir)\b"
)
_DATE_ANCHOR_RE = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+\d{1,2}\b"
)
_CIVIC_BODY_ANCHOR_RE = re.compile(
    r"\b(?:City Council|Planning Commission|County Commission|School Board|County Board)\b"
)


def has_local_anchor(text: str, cfg: dict | None) -> bool:
    """Does `text` contain at least one concrete, verifiable local specific:
    the town's own name, a street address, a specific date, or a named civic
    body? Used to gate columns/editorials against a location-less think-
    piece that never actually engages with the place it's supposedly about --
    see generate_article()'s retry-then-skip use of this in content/_base.py.

    Deliberately permissive (any ONE match passes) -- the bar is "at least
    one thing a reader could verify," not a minimum count. A false negative
    (a real local reference in a form this regex doesn't recognize) just
    costs one retry with an explicit instruction to include something
    checkable, not a wrongly-blocked piece -- see the retry pattern in
    content/_base.py.
    """
    display_name = (cfg or {}).get("display_name")
    if display_name and _word_boundary_pattern(display_name).search(text):
        return True
    if _STREET_ANCHOR_RE.search(text):
        return True
    if _DATE_ANCHOR_RE.search(text):
        return True
    if _CIVIC_BODY_ANCHOR_RE.search(text):
        return True
    return False


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
