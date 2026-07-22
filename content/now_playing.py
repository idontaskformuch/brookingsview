"""Live källa för media_recension: Wikidata SPARQL + Wikipedias summary-API.

Varför inte TMDb: TMDb:s API-villkor blev för dyra/restriktiva för en sajt som
planerar annonser (AdSense, se PLAN.md Stage 7). Wikidata är CC0 -- ingen
kommersiell begränsning alls, gratis, ingen API-nyckel behövs. Nackdel: inget
renodlat "aktuellt på bio"-koncept som TMDb:s now_playing, och ingen färdig
handlingssammanfattning i strukturerad data.

Löst i två steg:
  1. Wikidata SPARQL: filmer (wdt:P31 = wd:Q11424) med engelskt originalspråk
     (wdt:P364 = wd:Q1860, för att bias mot sådant en mainstream-biograf i en
     liten stad faktiskt skulle visa) och releasedatum inom en nyligen-period.
     Wikidata har inget "aktuellt på bio"-fält, så en ~75-dagarsperiod
     (ungefär en typisk biografvisningsperiod) är den bästa tillgängliga
     proxyn för "sannolikt fortfarande i teatrarna".
  2. Wikipedias REST-API (/page/summary/{titel}) ger en riktig sammanfattning
     från motsvarande engelska artikel -- CC-BY-SA, kräver attribution (se
     build_local_input, som märker underlaget med källan).

Popularitet approximeras med `wikibase:sitelinks` (antal språkversioner en
Wikidata-post har artiklar på) -- grovt men verkligt: en bred, mainstream-film
har långt fler språkversioner än ett smalt begränsat släpp. Verifierat mot
skarpt data (2026-07-22): gav bl.a. "The Odyssey" (Nolan, 2026), "Michael"
(2026), "Supergirl" (2026) -- äkta, aktuella titlar, inte daterade exempel.
"""
from __future__ import annotations

import datetime
import os

import requests

WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
WIKIPEDIA_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
# Wikidata:s publika SPARQL-endpoint kan svara långsamt under belastning (delad,
# global infrastruktur) -- 30s var för snålt och orsakade en verklig timeout-
# krasch under test. 60s ger marginal utan att hänga processen orimligt länge.
REQUEST_TIMEOUT = 60
# Ingen "aktuellt på bio"-koncept i Wikidata -- en typisk biografvisningsperiod
# är den bästa tillgängliga proxyn för "nyligen släppt, sannolikt fortfarande
# i teatrarna".
RECENT_WINDOW_DAYS = 75
CANDIDATE_LIMIT = 15


def _user_agent() -> str:
    return os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")


def _recent_films(today: datetime.date) -> list[dict]:
    start = (today - datetime.timedelta(days=RECENT_WINDOW_DAYS)).isoformat()
    end = today.isoformat()
    query = f"""
    SELECT ?film ?filmLabel (MIN(?releaseDate) AS ?minReleaseDate)
           (SAMPLE(?sitelinks) AS ?sampleSitelinks) (SAMPLE(?articleTitle) AS ?sampleArticleTitle) WHERE {{
      ?film wdt:P31 wd:Q11424;
            wdt:P577 ?releaseDate;
            wdt:P364 wd:Q1860;
            wikibase:sitelinks ?sitelinks.
      FILTER(?releaseDate >= "{start}T00:00:00Z"^^xsd:dateTime)
      FILTER(?releaseDate <= "{end}T23:59:59Z"^^xsd:dateTime)
      ?article schema:about ?film;
               schema:isPartOf <https://en.wikipedia.org/>;
               schema:name ?articleTitle.
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    GROUP BY ?film ?filmLabel
    ORDER BY DESC(?sampleSitelinks)
    LIMIT {CANDIDATE_LIMIT}
    """
    try:
        resp = requests.get(
            WIKIDATA_SPARQL_URL,
            params={"query": query, "format": "json"},
            headers={"User-Agent": _user_agent(), "Accept": "application/sparql-results+json"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        bindings = resp.json()["results"]["bindings"]
    except requests.RequestException as exc:
        # Nätverk/timeout mot en delad publik endpoint ska aldrig krascha hela
        # daily_content.py -- samma icke-blockerande hållning som
        # generate_illustration(). Tom lista -> next_pick() returnerar None ->
        # dagens publicering hoppas över, ingen artikel blockeras av ett
        # infrastrukturfel som inte har med innehållet att göra.
        print(f"  [now_playing] Wikidata query failed, skipping today: {exc}")
        return []
    return [
        {
            "title": b["filmLabel"]["value"],
            "release_date": b["minReleaseDate"]["value"][:10],
            "sitelinks": int(b["sampleSitelinks"]["value"]),
            "article_title": b["sampleArticleTitle"]["value"],
        }
        for b in bindings
    ]


def _wikipedia_summary(article_title: str) -> str | None:
    try:
        resp = requests.get(
            WIKIPEDIA_SUMMARY_URL.format(title=article_title.replace(" ", "_")),
            headers={"User-Agent": _user_agent()},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        return resp.json().get("extract")
    except requests.RequestException as exc:
        print(f"  [now_playing] Wikipedia summary fetch failed for '{article_title}': {exc}")
        return None


def next_pick(today: datetime.date, recently_reviewed_bodies: list[str]) -> dict | None:
    """Most-notable (by sitelink count) recently-released film not already reviewed.

    recently_reviewed_bodies: recent media_recension article bodies (same corpus
    originality_check already uses) -- a crude but dependency-free way to avoid
    reviewing the same film twice while it's still in its window. A movie's title
    is distinctive enough that a substring check against recent review text is a
    reasonable dedup signal without a schema change.

    Returns None if every recent candidate has already been reviewed, or none of
    them have a fetchable Wikipedia summary -- callers should skip today's
    publication rather than force a repeat or a summary-less review.
    """
    for film in _recent_films(today):
        if any(film["title"] in body for body in recently_reviewed_bodies):
            continue
        summary = _wikipedia_summary(film["article_title"])
        if not summary:
            continue
        film["summary"] = summary
        return film
    return None


def build_local_input(movie: dict) -> str:
    year = movie["release_date"][:4]
    return (
        f"Title: {movie['title']} ({year}), released {movie['release_date']}.\n\n"
        f"{movie['summary']}\n\n"
        f"(Source: Wikipedia, CC BY-SA)"
    )
