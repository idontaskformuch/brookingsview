"""Skoldistriktens egna meddelanden -- Brookings School District 05-1 och
Moreno Valley Unified School District (MVUSD).

INGETDERA distriktet har en dedikerad "closures/delays"-sida eller RSS-feed
(verifierat via direkt research 2026-08-10). Båda källorna nedan är
distriktets ALLMÄNNA meddelandeflöde -- vanliga notiser ("Bobcat Night",
"Back-to-School Night Schedules") blandat med det vi faktiskt är ute efter
(stängning/försenad start/nödläge). is_closure() flaggar deterministiskt
(nyckelordsmatchning, INGEN AI) vilka poster som ser ut att röra en
stängning/försening/nödläge, så frontend kan visa en banner bara för DE
posterna medan allt som skrapas ändå sparas (se db/migrations/010).

VARFÖR INGEN AI HÄR (till skillnad från t.ex. ai_pipeline/publish.py):
en stängningsnotis instruktion ("skolan är stängd i morgon") är exakt den
sorts text där ordval spelar roll -- distriktets EGEN formulering återges
oparafraserad. Se motsvarande resonemang för varningar i
ai_pipeline/publish.py:s moduldocstring (punkt 3).

KÄLLA 1 -- BROOKINGS (Thrillshare/Apptegy):
brookings.k12.sd.us är byggd på Apptegy (Nuxt SPA, server-side renderad --
sidans __NUXT_DATA__ avslöjade den bakomliggande JSON-API:n). Distriktets
"Live Feed" (deras egen sociala-medier-liknande meddelandeström) nås via
  https://thrillshare-cmsv2.services.thrillshare.com/api/v2/s/<section_id>/live_feeds
Verifierat: 200 OK med en ärlig User-Agent, ingen robots.txt-begränsning
(404, inget deklarerat), riktig JSON, inget Akamai-liknande bot-skydd --
samma "genuint öppen, inte kringgången" status som MLB Stats API hade (se
regional_sports_v1.py). section_id (256681) är specifik för Brookings
School District 05-1 (org-id 15084 i Thrillshares system) -- en annan ort
på samma plattform skulle ha ett annat section_id, konfigureras därför i
configen, inte hårdkodat.

KÄLLA 2 -- MORENO VALLEY (Finalsite):
mvusd.net är byggd på Finalsite. Ingen dold JSON-API hittad, men
distriktets nyhetslista (/engage/news) är vanlig server-renderad HTML --
robots.txt tillåter uttryckligen "/fs/pages/news" (samma underliggande
innehåll), med Crawl-delay: 5 för alla bottar (respekteras: se
MIN_REQUEST_INTERVAL_SECONDS). Varje post har ett STABILT eget id
(data-post-id) direkt i DOM:en -- ingen hash-baserad dedup behövs (se
UNIQUE(town_id, external_alert_id) i migrationen; en tidig skiss antog att
inget stabilt id fanns och föreslog en hash av (district+message+date), men
research visade att båda källorna faktiskt har riktiga id:n).

Confirmed DOM (2026-08-10, live på mvusd.net/engage/news):
    <article data-post-id="1096" ...>
      <div class="fsTitle"><a>Rubrik</a></div>
      <div class="fsDateTime"><time datetime="2026-08-03T10:55:00-07:00">...</time></div>
      <div class="fsSummary"><p>Sammanfattning</p></div>
    </article>
"""
from __future__ import annotations

import os
import re
import time

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# Finalsites robots.txt anger "Crawl-delay: 5" för alla bottar -- respekteras
# här trots att vi bara gör ETT anrop per körning (source_cfg kan i teorin
# peka flera Finalsite-sidor mot samma parser-instans i framtiden).
MIN_REQUEST_INTERVAL_SECONDS = 5

# Nyckelord som flaggar en post som sannolikt rör stängning/försening/nödläge,
# i stället för vanliga notiser (personalrekrytering, evenemang, utmärkelser).
# Medvetet enkel, textbaserad matchning -- transparent och granskningsbar,
# samma stil som guardrails.py:s förbjudna-ord-lista. Hellre en missad
# gränsdragning (posten hamnar bara i tabellen, inte i bannern) än en AI-
# klassificerare vars resonemang inte går att inspektera för just den här
# typen av text.
_CLOSURE_KEYWORDS = [
    "closed", "closure", "closing early", "early dismissal", "early release",
    "delayed start", "delayed opening", "two-hour delay", "late start",
    "cancel", "cancelled", "canceled", "no school", "school is out",
    "e-learning day", "remote learning day", "distance learning day",
    "snow day", "weather closure", "inclement weather",
    "emergency", "evacuat", "shelter in place", "lockdown", "lock-down",
    "boil water", "power outage", "gas leak",
]
_CLOSURE_RE = re.compile("|".join(re.escape(k) for k in _CLOSURE_KEYWORDS), re.IGNORECASE)


def is_closure(*texts: str | None) -> bool:
    haystack = " ".join(t for t in texts if t)
    return bool(_CLOSURE_RE.search(haystack))


class SchoolAlertsParser(BaseParser):
    table = "school_alerts"
    platform = "school_alerts"
    # UNIQUE-constrainten (se migration 010) är (town_id, external_alert_id),
    # INTE standarden (town_id, content_hash) -- båda källorna gav ett
    # riktigt stabilt post-id (se moduldocstring), så konflikmålet sätts
    # explicit. update_columns lämnas odeklarerat (DO NOTHING): en publicerad
    # skolnotis antas oföränderlig källdata, samma resonemang som möten/
    # event -- till skillnad från regional_sports_v1.py:s matcher, vars
    # status/resultat legitimt ändras över tid.
    conflict_columns = ("town_id", "external_alert_id")

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        source = self.source_cfg.get("source", "")
        if source == "thrillshare_live_feed":
            return self._fetch_thrillshare()
        if source == "finalsite_news":
            return self._fetch_finalsite()
        raise ValueError(f"okänd school_alerts source: {source!r}")

    def _fetch_thrillshare(self) -> FetchResult:
        url = self.source_cfg["url"]
        r = requests.get(url, headers=self._headers(), timeout=20)
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="application/json",
                           url=url, http_code=r.status_code)

    def _fetch_finalsite(self) -> FetchResult:
        url = self.source_cfg["url"]
        time.sleep(MIN_REQUEST_INTERVAL_SECONDS)
        r = requests.get(url, headers=self._headers(), timeout=20)
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="text/html",
                           url=url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        source = self.source_cfg.get("source", "")
        district = self.source_cfg.get("district", self.cfg.get("display_name", ""))
        if source == "thrillshare_live_feed":
            return self._parse_thrillshare(fetched, district)
        if source == "finalsite_news":
            return self._parse_finalsite(fetched, district)
        raise ValueError(f"okänd school_alerts source: {source!r}")

    def _parse_thrillshare(self, fetched: FetchResult, district: str) -> list[dict]:
        import json
        payload = json.loads(fetched.raw.decode("utf-8"))
        rows = []
        for item in payload.get("live_feeds", []):
            external_id = str(item["id"])
            # "status" är fältnamnet Thrillshare själva använder för
            # meddelandets HTML-brödtext (inget att göra med publiceringsstatus).
            message_html = item.get("status") or ""
            message = BeautifulSoup(message_html, "html.parser").get_text(" ", strip=True)
            posted_at = item.get("time") or item.get("publishing_at")
            if not message or not posted_at:
                continue

            rows.append({
                "district": district,
                "external_alert_id": external_id,
                "title": None,  # live feed-poster har ingen egen rubrik, bara brödtext
                "message": message,
                "url": self.source_cfg.get("public_url"),
                "posted_at": posted_at,
                "is_closure": is_closure(message),
                "source": "thrillshare_live_feed",
                "raw_data": item,
                "content_hash": content_hash("school_alert", external_id, message),
            })
        return rows

    def _parse_finalsite(self, fetched: FetchResult, district: str) -> list[dict]:
        soup = BeautifulSoup(fetched.raw, "html.parser")
        rows = []
        for article in soup.select("article[data-post-id]"):
            external_id = article.get("data-post-id")
            title_el = article.select_one(".fsTitle a")
            time_el = article.select_one(".fsDateTime time[datetime]")
            summary_el = article.select_one(".fsSummary")
            title = title_el.get_text(" ", strip=True) if title_el else None
            posted_at = time_el.get("datetime") if time_el else None
            summary = summary_el.get_text(" ", strip=True) if summary_el else ""
            if not external_id or not title or not posted_at:
                continue

            href = title_el.get("href") if title_el else None
            rows.append({
                "district": district,
                "external_alert_id": external_id,
                "title": title,
                "message": summary or title,
                "url": href,
                "posted_at": posted_at,
                "is_closure": is_closure(title, summary),
                "source": "finalsite_news",
                "raw_data": {"title": title, "summary": summary, "url": href},
                "content_hash": content_hash("school_alert", external_id, title, summary),
            })
        return rows
