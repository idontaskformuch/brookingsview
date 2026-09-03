"""Consolidated pre-publish validation gate.

See "Recurring-traffic layer" handoff, Phase 0 (2026-09-03): before this
package, the checks that existed (ai_pipeline/town_guard.py's wrong-town
blocklist, ai_pipeline/guardrails.py's fact/banned-content net, and each
generator's own bespoke retry-then-fallback loop) were scattered per
generator, wired in one at a time as incidents happened to surface them. This
package is the single, shared choke point every generator calls before
publishing AI-written text: pre_publish_check(text, source_records, cfg, ...).

It does not replace ai_pipeline/guardrails.py or ai_pipeline/town_guard.py --
it composes them, plus the checks that had no home yet (state/place
coherence, date-word coherence, intra-record venue/address/phone
consistency, incoherent fragments). See pre_publish_check.py's own docstring
for exactly which check lives where and why.
"""
from __future__ import annotations

from validation.pre_publish_check import PrePublishResult, pre_publish_check

__all__ = ["PrePublishResult", "pre_publish_check"]
