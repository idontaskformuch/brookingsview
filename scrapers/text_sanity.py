"""Text-sanity heuristics for scraped/parsed content -- catches corrupted or
garbled decoding output (wrong charset assumed, partial mojibake, a feed that
silently degrades into replacement characters) before it reaches the AI
pipeline or a reader-facing page.

Prompted by a real gap found in scrapers/parsers/events.py: the third-party
`icalendar` package's own byte-decoding (`icalendar.parser_tools.to_unicode`)
assumes `utf-8-sig` and silently falls back to `errors="replace"` on a
decode failure, with nothing downstream inspecting the result before it got
stored. No heuristic here is perfect -- the goal is a cheap, fast pre-filter
that catches the obviously-broken cases (whole blocks of replacement
characters, long repeated-character runs, wholesale non-Latin-script
garbling), not a language filter or a spellchecker.
"""
from __future__ import annotations

import re
import unicodedata

_REPLACEMENT_CHAR = "�"
# Samma tecken upprepat 8+ gånger i rad -- långt förbi vad ett äkta "!!!!!!"
# eller "------" i mänskligt skriven text rimligen når.
_LONG_RUN_RE = re.compile(r"(.)\1{7,}")


def _non_latin_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    non_latin = sum(1 for c in letters if "LATIN" not in unicodedata.name(c, ""))
    return non_latin / len(letters)


def is_suspicious(text: str | None, non_latin_threshold: float = 0.3) -> bool:
    """Best-effort "does this look corrupted" check. Threshold is set well
    above any normal amount of stray accented/foreign characters (a venue
    name with an accent, an emoji) -- tuned to catch wholesale garbling of
    an entire field, not the occasional non-ASCII character."""
    if not text:
        return False
    if _REPLACEMENT_CHAR in text:
        return True
    if _LONG_RUN_RE.search(text):
        return True
    if _non_latin_ratio(text) > non_latin_threshold:
        return True
    return False
