"""The single pre-publish validation entry point -- see validation/__init__.py
and the package docstring for the overall shape.

pre_publish_check() composes five checks:
  1. Wrong-town leakage      -- ai_pipeline.town_guard.validate_town_identity()
  2. Wrong state/place       -- validation.place_state
  3. Date coherence          -- validation.date_coherence
  4. Intra-record consistency -- validation.record_consistency
  5. Incoherent fragments    -- validation.incoherent_fragments

Checks 1 and 2 both need `cfg` (the active town's own config) to know what
"wrong" means; 3 needs the record's own date; 4 needs the source record(s)
and, where the caller has one, the structured `meta` (tone_v2's
{summary, meta} shape) rather than just prose. Every check is independently
importable and testable (see validation/*.py + tests/test_*.py) --
pre_publish_check() itself is thin orchestration, not where the logic lives.

"On failure: do not publish, do not template-fallback." (handoff, Phase 0) --
this function only reports pass/fail; it is the CALLER's job to actually skip
publication on a failure, same as ai_pipeline/town_guard.py's existing
hard-tier gate in content/_base.py:generate_article() already does. A
Phase 0 failure must never fall through to a generator's template-fallback
path the way an ai_pipeline.guardrails.validate() failure does -- those are
a different, pre-existing failure class (a fact not present in source) with
a different, pre-existing safe answer (a plain templated line built straight
from structured fields is still correct); a Phase 0 failure (wrong town,
wrong state, wrong date, mismatched venue contact, garbled/incoherent text)
has no safe template to fall back to, because the input itself is suspect.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from datetime import datetime

from ai_pipeline.town_guard import validate_town_identity
from validation.date_coherence import check_date_coherence
from validation.incoherent_fragments import check_incoherent_fragments
from validation.place_state import check_place_state
from validation.record_consistency import check_record_consistency


@dataclass
class PrePublishResult:
    passed: bool
    # Every check that failed, in the order above (usually 0 or 1 -- listed
    # rather than short-circuited on the first hit so one failing log line
    # shows the whole picture instead of forcing a fix-one-rerun-see-next
    # loop).
    failing_checks: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    # Review-tier hits from check 1 (ai_pipeline.town_guard's REVIEW_BLOCKLIST,
    # e.g. "prairie") -- never block on their own, surfaced so a caller can
    # log them exactly as content/_base.py already did before this module
    # existed.
    reviews: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


def pre_publish_check(
    text: str,
    source_records: list[dict] | dict | None,
    cfg: dict,
    *,
    content_type: str | None = None,
    record_date: datetime | None = None,
    meta: dict | None = None,
    record_id: str | int | None = None,
    reference_now: datetime | None = None,
) -> PrePublishResult:
    """Run every Phase 0 check against `text` (generated title+body, or a
    tone_v2 `summary`) and its backing `source_records` (a single record dict
    or a list -- see validation._text.flatten_records).

    `record_id`, when given, is only used for the failure log line below --
    it is never validated itself. Failures are printed to stderr (record id,
    failing check(s), offending span(s)) so they're visible in job output
    without the caller needing its own logging for this -- matches this
    codebase's existing convention (content/_base.py, format_prompt.py both
    print their own guardrail rejections the same way).
    """
    town_id = (cfg or {}).get("town_id")
    failing_checks: list[str] = []
    violations: list[str] = []
    reviews: list[str] = []

    if town_id:
        identity = validate_town_identity(text, town_id)
        if not identity.passed:
            failing_checks.append("wrong_town_leakage")
            violations.extend(identity.violations)
        reviews.extend(identity.reviews)

    place = check_place_state(text, source_records, cfg)
    if not place.passed:
        failing_checks.append("wrong_state_place")
        violations.extend(place.violations)

    date_result = check_date_coherence(text, record_date, cfg, reference_now=reference_now)
    if not date_result.passed:
        failing_checks.append("date_coherence")
        violations.extend(date_result.violations)

    consistency = check_record_consistency(text, meta, source_records, cfg)
    if not consistency.passed:
        failing_checks.append("record_consistency")
        violations.extend(consistency.violations)

    fragments = check_incoherent_fragments(text, source_records, content_type)
    if not fragments.passed:
        failing_checks.append("incoherent_fragments")
        violations.extend(fragments.violations)

    passed = len(failing_checks) == 0
    id_label = f" record={record_id}" if record_id is not None else ""
    if not passed:
        print(
            f"  pre_publish_check failed{id_label} checks={','.join(failing_checks)}",
            file=sys.stderr,
        )
        for v in violations:
            print(f"    - {v}", file=sys.stderr)
    if reviews:
        print(f"  pre_publish_check: review-tier hit{id_label} ({', '.join(reviews)})", file=sys.stderr)

    return PrePublishResult(passed=passed, failing_checks=failing_checks, violations=violations, reviews=reviews)
