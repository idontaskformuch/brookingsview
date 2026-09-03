"""Phase 0 check 5: incoherent fragments.

"A sentence with no lexical overlap with any source record, or a
truncated/dangling fragment." -- Recurring-traffic layer handoff. This is
the check that would have caught the actual failure mode narrated by (and
named as the reason for pulling) the culture essay this handoff references:
"a fragment of Thai script looping without meaning" -- a real class of bug
(scrapers/parsers/events.py's icalendar decoding gap, see
scrapers/text_sanity.py's own docstring), just never checked for on
AI-GENERATED output before, only on scraped input.

Two independent sub-checks per sentence:
  1. Corruption -- reuses scrapers/text_sanity.py's is_suspicious() as-is
     (replacement characters, long repeated-character runs, wholesale
     non-Latin garbling). Applies to every content type unconditionally --
     garbled text is never acceptable regardless of genre.
  2. Lexical overlap -- a sentence sharing not one content word with any
     source record. Applies ONLY to fact-extractive content types (meetings,
     events, alerts, digests): an interpretive essay/column/editorial is
     SUPPOSED to contain sentences of pure analysis with no source
     word-for-word echo ("This is worth pausing on, not because a scheduling
     error is scandalous, but because it is instructive" -- a real sentence
     from that same pulled essay, and a perfectly legitimate one on its own
     terms). Applying the overlap rule there would flag the exact editorial
     voice the content track exists to produce. See EXTRACTIVE_CONTENT_TYPES
     below and tests/test_incoherent_fragments.py for both directions.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from scrapers.text_sanity import is_suspicious
from validation._text import content_words, flatten_records, split_sentences

# Content types where every sentence is expected to trace back to source
# facts -- the lexical-overlap sub-check only applies here. Interpretive/
# essay types (culture_essay, editorial, kvick_essa, vetenskap_kronika,
# media_recension) are deliberately excluded -- see module docstring.
# vardagsmiddag (recipes) is also excluded: its narrative intro is
# free-form food writing, not a source-extractive summary (the structured
# ingredients/instructions lists it DOES generate are a separate, already-
# validated shape -- content/_base.py's extract_marked_list()).
EXTRACTIVE_CONTENT_TYPES: frozenset[str] = frozenset({
    "meeting", "meeting_followup", "event", "alert",
    "home_sales_digest", "sports_digest", "local_sports_digest",
    "jackrabbits_season_summary", "university_digest", "workplace_watch_digest",
    "closure_watch", "new_in_town_digest", "weekly",
    "project_thread_synthesis", "project_thread_summary",
    "free_teaser_facility", "free_teaser_event",
})

# A sentence this short (e.g. a dangling "and the" left after truncation)
# has too little text for the word-overlap check to mean anything either
# way -- skip it rather than flag every short, legitimate transition
# sentence a real writer might use.
_MIN_WORDS_FOR_OVERLAP_CHECK = 4


@dataclass
class CheckResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


def check_incoherent_fragments(
    text: str, source_records: list[dict] | dict | None, content_type: str | None,
) -> CheckResult:
    violations: list[str] = []
    haystack_words = content_words(flatten_records(source_records))
    check_overlap = content_type in EXTRACTIVE_CONTENT_TYPES

    for sentence in split_sentences(text):
        if is_suspicious(sentence):
            violations.append(f"corrupted/garbled fragment: {sentence[:80]!r}")
            continue

        if not check_overlap:
            continue
        words = content_words(sentence)
        if len(words) < _MIN_WORDS_FOR_OVERLAP_CHECK:
            continue
        if haystack_words and not (words & haystack_words):
            violations.append(f"no lexical overlap with any source record: {sentence[:80]!r}")

    return CheckResult(passed=len(violations) == 0, violations=violations)
