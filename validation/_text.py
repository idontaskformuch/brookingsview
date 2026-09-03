"""Shared text-handling helpers for the validation/ checks.

Deliberately thin: real fact-extraction/normalization (numbers, address
abbreviations, possessives) already lives in ai_pipeline/guardrails.py and is
reused via source_to_text(), not reimplemented here -- these checks only need
sentence splitting and coarse word-set overlap, not that module's full
haystack-building machinery.
"""
from __future__ import annotations

import re

from ai_pipeline.guardrails import source_to_text

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_WORD_RE = re.compile(r"[A-Za-z']+")

# Function words carry no topical signal -- excluding them from a lexical-
# overlap check means "the meeting was held" doesn't spuriously "overlap"
# with any source on the strength of "the"/"was" alone. Deliberately small
# and hand-picked (same philosophy as guardrails.py's own _FUNCTION_WORDS),
# not a full stopword-list dependency this codebase doesn't otherwise have.
_FUNCTION_WORDS = {
    "the", "a", "an", "of", "and", "for", "in", "on", "at", "to", "by", "is",
    "are", "was", "were", "be", "been", "being", "it", "its", "this", "that",
    "these", "those", "as", "with", "from", "not", "no", "but", "or", "if",
    "will", "would", "can", "could", "has", "have", "had", "than", "then",
    "so", "such", "which", "who", "what", "when", "where", "why", "how",
}


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]


def content_words(text: str) -> set[str]:
    """Lowercased words, function words dropped -- the topical signal a
    lexical-overlap check compares, not a full-text diff."""
    return {w.lower() for w in _WORD_RE.findall(text)} - _FUNCTION_WORDS


def flatten_records(source_records: list[dict] | dict | None) -> str:
    """One text haystack out of one record or a list of records -- every
    check in this package takes source_records in either shape (a single
    record is the common case; a list covers e.g. a digest woven from many
    rows) so callers never need a `[record]` wrapper for the common case."""
    if not source_records:
        return ""
    records = source_records if isinstance(source_records, list) else [source_records]
    return " ".join(source_to_text(r) for r in records if r)
