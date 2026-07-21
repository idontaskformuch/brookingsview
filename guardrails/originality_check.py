"""Originalitetskontroll — fångar oavsiktlig nästan-dubblettpublicering.

Jämför en ny artikel mot tidigare publicerade texter på sajten (t.ex. föregående
veckors krönikor av samma typ). Syftet är att undvika att AI-lagret av misstag
återanvänder samma vinkel/formuleringar två gånger, inte att kringgå extern
plagiatdetektion mot texter utanför sajten.

Metod: difflib.SequenceMatcher-kvot (tecken-baserad longest-matching-blocks-likhet).
Testad mot en nästan-identisk omskrivning (två ord ändrade i en annars identisk text):
gav 0.94 likhet mot 0.19-0.37 för genuint olika texter — ordn-gram/Jaccard-likhet
missade samma fall (0.44-0.6, under rimligt tröskelvärde) eftersom några få ändrade
ord bryter oproportionerligt många n-gram-fönster.
"""
from __future__ import annotations

from difflib import SequenceMatcher

SIMILARITY_THRESHOLD = 0.7


def similarity(a: str, b: str) -> float:
    """Textlikhet mellan a och b, 0.0-1.0."""
    return SequenceMatcher(None, a, b).ratio()


def is_original(text: str, existing_corpus: list[str], threshold: float = SIMILARITY_THRESHOLD) -> bool:
    """False om text liknar någon text i existing_corpus mer än threshold."""
    return all(similarity(text, existing) < threshold for existing in existing_corpus)
