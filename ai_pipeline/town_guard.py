"""Cross-site (Brookings <-> Moreno Valley <-> Broomfield) contamination guard.

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

CONFIG-DRIVEN (Recurring-traffic layer handoff, Phase 0, check 1 -- "checked
against all towns' configs, so the check strengthens automatically as towns
are added"): HARD_BLOCKLIST/REVIEW_BLOCKLIST below used to be hand-maintained
Python dicts, which meant every new town required manually updating every
OTHER town's entry too -- confirmed live 2026-09-03 this had already drifted:
broomfield_co's own list was missing several moreno_valley_ca terms
(Alessandro/Perris Blvd/951) that brookings_sd's list already had, an
asymmetric gap nobody had caught. Now derived at import time from each
config's own `identity.terms`/`identity.review_terms` -- a town declares what
identifies ITSELF once, in its own config, and every other town's hard
blocklist is the union of every OTHER town's declared terms. Dropping in
configs/<new_town>.json with its own `identity.terms` is enough; no other
file needs editing.

Shared by:
  - content/_base.py:generate_article() -- live pre-publish gate. A hard-tier
    match means the draft does not get published, full stop -- see that
    module for the retry-then-skip behavior.
  - validation/pre_publish_check.py -- the consolidated Phase 0 gate; this
    module's validate_town_identity() IS that spec's check 1, reused rather
    than reimplemented (see that module's own docstring).
  - scripts/scan_contamination.py -- retroactive, read-only scan of already-
    published `stories` rows. Produces a report; never unpublishes anything
    itself. A human makes that call, per the audit brief.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Delad med content/_base.py:town_label() (som importerar detta i stället för
# att hålla en egen kopia) -- lägg till fler delstater här när fler orter
# tillkommer.
STATE_NAMES = {
    "SD": "South Dakota",
    "CA": "California",
    "CO": "Colorado",
}

_CONFIGS_DIR = Path(__file__).resolve().parent.parent / "configs"


@lru_cache(maxsize=1)
def _load_all_configs() -> dict[str, dict]:
    """town_id -> full config dict, one entry per configs/*.json found.

    Cached: a batch run (scraper, digest, content-track script) calls
    validate_town_identity() once per row/article, and configs don't change
    mid-run -- re-parsing 3+ JSON files from disk on every single call would
    be pure waste. Tests that need to exercise a different config set should
    call _load_all_configs.cache_clear() first (see test_town_guard.py).
    """
    configs: dict[str, dict] = {}
    for path in sorted(_CONFIGS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        town_id = data.get("town_id")
        if town_id:
            configs[town_id] = data
    return configs


def _self_identity_terms(cfg: dict) -> list[str]:
    """The terms that identify THIS town -- its own config's curated
    `identity.terms` (landmarks, institutions, highways: the specifics no
    generic field captures) PLUS display_name/county, derived automatically
    so a config never has to duplicate what it already states elsewhere in
    itself. County's trailing parenthetical (Broomfield's config reads
    "Broomfield County (consolidated city-county)") is stripped -- that's a
    descriptive aside for humans reading the config, not part of the
    blockable term itself.

    Deliberately does NOT include the town's full state name (unlike an
    earlier version of this function). Confirmed live 2026-09-03: a bare
    state name is only safe to hard-block when the CHECKING town has no
    legitimate reason to ever mention it -- true for e.g. Moreno Valley
    mentioning South Dakota, false for Brookings' own SDSU athletics content,
    which routinely and legitimately names away-game opponents' states (e.g.
    a real Denver, Colorado road game -- "Colorado" would otherwise hard-
    block that blurb unconditionally, with no source-grounding at all, the
    exact class of false positive the handoff's own check-2 warning was
    about). validation/place_state.py (check 2) already owns state-level
    place correctness correctly -- SOURCE-GROUNDED, so a real away-game
    state passes and a fabricated one still fails -- so this function no
    longer needs to duplicate that job with a blind, ungrounded term match.
    A contaminated draft naming another town's state still gets caught (by
    check 2, or by this function's OTHER terms -- display_name/county/
    curated landmarks, which a different town's content essentially never
    has a legitimate reason to name)."""
    terms = list(cfg.get("identity", {}).get("terms", []))
    if cfg.get("display_name"):
        terms.append(cfg["display_name"])
    if cfg.get("county"):
        terms.append(cfg["county"].split(" (")[0].strip())
    # dict.fromkeys: de-dup while preserving first-seen order (a curated
    # term and an auto-derived one can legitimately coincide, e.g. a town
    # that also lists its own display_name in `identity.terms` by habit).
    return list(dict.fromkeys(t for t in terms if t))


def _build_hard_blocklist(configs: dict[str, dict] | None = None) -> dict[str, list[str]]:
    """`configs` is injectable (defaults to the real configs/*.json on disk
    via _load_all_configs()) so tests can prove "strengthens automatically as
    towns are added" with a synthetic 4th town, with no real config file on
    disk and no monkeypatching of the disk-backed cache -- see
    test_town_guard.py."""
    configs = _load_all_configs() if configs is None else configs
    per_town = {town_id: _self_identity_terms(cfg) for town_id, cfg in configs.items()}
    return {
        town_id: list(dict.fromkeys(
            term for other_id, terms in per_town.items() if other_id != town_id for term in terms
        ))
        for town_id in configs
    }


def _build_review_blocklist(configs: dict[str, dict] | None = None) -> dict[str, list[str]]:
    configs = _load_all_configs() if configs is None else configs
    return {
        town_id: list(cfg.get("identity", {}).get("review_terms", []))
        for town_id, cfg in configs.items()
    }


@dataclass
class GuardrailResult:
    passed: bool
    violations: list[str] = field(default_factory=list)
    # Vanliga nog för falska positiva att inte blockera på egen hand (se
    # REVIEW_BLOCKLIST), men värda att logga/rapportera för mänsklig koll.
    reviews: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


# Hård karantän: en träff här ska ALDRIG publiceras för den här orten. Derived
# from every configs/*.json's own `identity.terms` -- see module docstring
# and _build_hard_blocklist() above. NOT a plain module-level constant
# anymore (would freeze at first import, before tests can swap in a
# different config set) -- HARD_BLOCKLIST/REVIEW_BLOCKLIST/ALL_TOWN_IDS below
# are computed once here at import time from whatever configs/*.json exists
# on disk right now, same timing as the old hardcoded dicts had, but sourced
# from the real config files instead of hand-maintained by a person.
HARD_BLOCKLIST: dict[str, list[str]] = _build_hard_blocklist()

# Granska, blockera inte: vanliga nog som vanliga engelska ord/gatunamn att
# en hård spärr skulle kosta mer i onödiga omgenereringar än den förhindrar
# (t.ex. "prairie" som metafor, "Sixth Street" som finns i många städer).
# Derived from each town's own config's `identity.review_terms`.
REVIEW_BLOCKLIST: dict[str, list[str]] = _build_review_blocklist()

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
