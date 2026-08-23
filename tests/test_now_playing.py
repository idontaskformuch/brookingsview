"""Regression tests for content/now_playing.py's review-score parsing (see
NEEDS-HUMAN-REVIEW.md "Review Writing Standard" for why this exists: the
content-generation prompt needs REAL aggregate critic-reception numbers, not
an invented named-critic quote, and Wikidata's P444/P447/P459 statements are
the only legitimate free source this project has for that).

_parse_review_score_bindings() is a pure function split out from the network
call specifically so it's testable against a fixture -- no live SPARQL
request needed. The fixture shape below is the REAL response observed live
2026-08-23 against wd:Q108839994 (Oppenheimer, 2023 film), including the
Metacritic label-resolution quirk documented in the function's docstring.
"""
from content.now_playing import _parse_review_score_bindings

REAL_OPPENHEIMER_BINDINGS = [
    {
        "reviewScore": {"value": "90/100"},
        "reviewScoreByLabel": {"value": "Q150248"},  # unresolved label, real quirk
        "determinationMethodLabel": {"value": "Metascore"},
    },
    {
        "reviewScore": {"value": "93%"},
        "reviewScoreByLabel": {"value": "Rotten Tomatoes"},
        "determinationMethodLabel": {"value": "Tomatometer score"},
    },
    {
        "reviewScore": {"value": "8.2/10"},
        "reviewScoreByLabel": {"value": "IMDb"},
        "determinationMethodLabel": {"value": "weighted average"},
    },
]


def test_falls_back_to_determination_method_when_source_label_unresolved():
    scores = _parse_review_score_bindings(REAL_OPPENHEIMER_BINDINGS)
    metascore = next(s for s in scores if s["score"] == "90/100")
    assert metascore["source"] == "Metascore"  # NOT the bare "Q150248"


def test_uses_source_label_when_it_resolves():
    scores = _parse_review_score_bindings(REAL_OPPENHEIMER_BINDINGS)
    rt = next(s for s in scores if s["score"] == "93%")
    assert rt["source"] == "Rotten Tomatoes"


def test_all_three_real_scores_parsed():
    scores = _parse_review_score_bindings(REAL_OPPENHEIMER_BINDINGS)
    assert len(scores) == 3


def test_statement_with_no_score_value_is_skipped():
    bindings = [{"reviewScoreByLabel": {"value": "Rotten Tomatoes"}}]
    assert _parse_review_score_bindings(bindings) == []


def test_statement_with_neither_label_resolving_is_dropped():
    bindings = [{"reviewScore": {"value": "50%"}, "reviewScoreByLabel": {"value": "Q999999"}}]
    assert _parse_review_score_bindings(bindings) == []


def test_empty_bindings_returns_empty_list():
    assert _parse_review_score_bindings([]) == []
