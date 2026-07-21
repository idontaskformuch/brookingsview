"""Stilfilter för genererade krönikor/recensioner/recept.

Detta är läsbarhets-/konsekvenspolering, INTE ett verktyg för att dölja att texten är
AI-genererad. Varje artikel bär en synlig byline ("AI-genererad") -- clean() finns för
att texten ska hålla en jämn, redigerad kvalitet (konsekventa citattecken, inga
em-streck, ingen skiftestecken-spam, ingen dubbel whitespace), inte för att fly
AI-detektion.

Em-streck-ersättningen är en backup: systemprompterna instruerar redan modellen att
inte använda em-streck (—) alls, av husstil/läsbarhetsskäl (rytm, inte AI-dolgoing).
clean() fångar det som ändå slinker igenom.
"""
from __future__ import annotations

import re
import unicodedata

_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_BLANK_LINE_RE = re.compile(r"\n{3,}")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.;:!?])")
_REPEATED_PUNCT_RE = re.compile(r"([!?])\1+")
_REPEATED_COMMA_RE = re.compile(r",\s*,+")
_STRAIGHT_DOUBLE_QUOTE_RE = re.compile(r'"([^"]*)"')
_STRAIGHT_SINGLE_QUOTE_RE = re.compile(r"(?<![A-Za-z])'([^']*)'(?![A-Za-z])")
# Em-streck (—), med eller utan omgivande whitespace -- ersätts med kommatecken,
# husstilens fallback när modellen ändå råkar skriva ett. En-streck (–) rörs inte,
# det används legitimt i sifferintervall ("2020–2023").
_EM_DASH_RE = re.compile(r"\s*—\s*")


def clean(text: str) -> str:
    """Polera text för konsekvent redaktionell kvalitet. Ändrar inte sakinnehåll."""
    s = unicodedata.normalize("NFKC", text)

    # Konsekventa citattecken (raka -> kurviga, husstil).
    s = _STRAIGHT_DOUBLE_QUOTE_RE.sub(r"“\1”", s)
    s = _STRAIGHT_SINGLE_QUOTE_RE.sub(r"‘\1’", s)

    # Husstil: inga em-streck.
    s = _EM_DASH_RE.sub(", ", s)

    # Whitespace och skiljetecken-hygien.
    s = _MULTI_SPACE_RE.sub(" ", s)
    s = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", s)
    s = _REPEATED_PUNCT_RE.sub(r"\1", s)
    s = _REPEATED_COMMA_RE.sub(",", s)
    s = _MULTI_BLANK_LINE_RE.sub("\n\n", s)

    return "\n".join(line.strip() for line in s.split("\n")).strip()
