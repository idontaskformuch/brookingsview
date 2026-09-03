"""Phase 0 check 2: wrong state/place.

"A place name must resolve to the active town's state OR appear in the
source record." -- Recurring-traffic layer handoff. Narrower than
ai_pipeline/town_guard.py's check 1 (which blocks a fixed list of the OTHER
active towns' own identity terms): this one is state-name-scoped and applies
to ANY US state, not just the other two/three towns currently live, so it
catches a stray wrong state that isn't one of THIS fleet's own towns too (a
copy-pasted dateline, a wrong-state city name).

Deliberately grounded against the source record before flagging anything --
NOT a bare "any out-of-state mention is suspicious" rule. Sports and
university content legitimately names out-of-state opponents/locations
constantly (an away game, a visiting team's hometown), and those are real,
sourced facts, not leakage -- see tests/test_place_state.py's sports fixture,
built from ai_pipeline/sports_weekly_digest.py's actual record shape,
asserting this does NOT fire on a legitimate away-game state mention. This is
the same "must appear in source" grounding ai_pipeline/guardrails.py already
uses for proper nouns/numbers, just applied specifically to state names so a
failure here reports a clear, specific reason ("wrong state") instead of a
generic "entity missing from source" hit.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ai_pipeline.town_guard import STATE_NAMES
from validation._text import flatten_records

# Every US state (plus DC) by full name -- deliberately the complete list,
# not just the fleet's currently-active states, so a wrong state that ISN'T
# one of this fleet's own towns (e.g. a stray "Texas") is still catchable.
# Kept here rather than a package dependency -- 50 static strings, no reason
# to pull in a geo library for this.
US_STATE_NAMES: tuple[str, ...] = (
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
)


@dataclass
class CheckResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


def _word_boundary_search(term: str, text: str) -> bool:
    return re.search(r"\b" + re.escape(term) + r"\b", text, re.IGNORECASE) is not None


def check_place_state(text: str, source_records: list[dict] | dict | None, cfg: dict) -> CheckResult:
    active_state = STATE_NAMES.get((cfg or {}).get("state"), (cfg or {}).get("state"))
    haystack = flatten_records(source_records)

    violations = []
    for state_name in US_STATE_NAMES:
        if state_name == active_state:
            continue
        if not _word_boundary_search(state_name, text):
            continue
        if _word_boundary_search(state_name, haystack):
            continue  # a real, sourced out-of-state reference -- fine
        violations.append(
            f"state '{state_name}' named but is neither the active town's state "
            f"({active_state!r}) nor present in the source record"
        )

    return CheckResult(passed=len(violations) == 0, violations=violations)
