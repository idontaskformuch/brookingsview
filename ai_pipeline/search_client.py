"""Tunn wrapper runt Brave Search API -- enda sökkällan i pipelinen.

Byggd för ai_pipeline/workplace_watch_digest.py: Glassdoor och Indeed har
ingen publik API och blockerar aktivt skrapning (robots.txt + anti-bot), så
review-trenddata hämtas i stället via sök-och-sammanfatta (denna modul hämtar
träfftext, en annan modul låter AI:n parafrasera den, se guardrails.
validate_employer_hedging) -- aldrig ett direkt skrap av någon av sajterna.

SearchUnavailable hanteras EXAKT som format_prompt.GenerationUnavailable:
anroparen faller tillbaka (hoppar över arbetsgivaren den månaden, loggar,
fortsätter), aldrig en okontrollerad krasch -- samma princip, se
GenerationUnavailable-docstringen i format_prompt.py.
"""
from __future__ import annotations

import os

import requests

_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"


class SearchUnavailable(Exception):
    """Sök-API:et kunde inte anropas -- saknad nyckel, rate limit, nätverksfel.
    Inte ett kvalitetsavslag; hanteras som ett fallback-läge av anroparen."""


def brave_search(query: str, count: int = 10) -> list[dict]:
    """Kör en sökning, returnerar [{title, description, url}, ...].

    Bara metadata från Brave:s eget träfflistnings-API (titel + snippet-
    beskrivning) -- aldrig sidans fulltextinnehåll. Det är denna snippet-text
    som blir SOURCE DATA för AI-sammanfattningen, inte en skrapning av
    Glassdoor/Indeed själva.
    """
    api_key = os.environ.get("BRAVE_API_KEY")
    if not api_key:
        raise SearchUnavailable("BRAVE_API_KEY saknas i .env/GitHub-secrets")

    try:
        resp = requests.get(
            _ENDPOINT,
            params={"q": query, "count": count},
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": api_key,
            },
            timeout=15,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise SearchUnavailable(str(exc)) from exc

    results = (resp.json().get("web") or {}).get("results") or []
    return [
        {
            "title": r.get("title", ""),
            "description": r.get("description", ""),
            "url": r.get("url", ""),
        }
        for r in results
    ]
