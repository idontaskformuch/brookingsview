"""Vail Resorts corporate newsroom feed -- Broomfield only.

Se Handoff: "Vail Resorts news section (/vail-resorts) — Broomfield only".
INTE hyperlokalt innehåll -- en spegling av bolagets egen newsroom-listning
(news.vailresorts.com/news-and-stories), eftersom Vail Resorts (NYSE: MTN)
har sitt huvudkontor i Broomfield.

VERIFIERAT LIVE 2026-08-27, INNAN någon kod skrevs (i den ordningen kravet
i handoffen ställer det):
  - https://news.vailresorts.com/robots.txt finns INTE (redirectar 302 till
    en 404-sida) -- ingen Disallow, ingen Crawl-delay deklarerad. Grönt ljus
    att fortsätta med den primära källan; PR Newswire-reservplanen behövdes
    aldrig och är INTE implementerad här.
  - Listningssidan är server-renderad HTML (en WordPress-baserad newsroom-
    mall, klassprefix "wd_"), ingen JS-mur.
  - Paginering: ?o=<offset>&l=<pagesize> fungerar identiskt med och utan
    o=0 för sida 1 (verifierat).
  - Alla tre länkformerna i handoffen förekommer VERKLIGEN blandat i samma
    listning (verifierat på sida 1): "?item=123178" (query-param),
    "/2026-08-18-Is-Winter-About-to-Show-Off-..." (daterad slug), och
    "/KingdomOfBreck" (vanity-slug). Alla ges redan som absoluta URL:er
    direkt i listningen (inga relativa hrefs observerade), men
    _resolve_url() hanterar en relativ form ändå, defensivt.
  - INGET lang-attribut finns någonstans (varken per-item eller på
    <html lang>, som visade sig vara "en-US" även på en bekräftat
    spansk artikel) -- den nyckelordsbaserade heuristiken nedan är alltså
    INTE en andrahandslösning, det är den enda metoden som faktiskt
    fungerar. Kalibrerad mot riktiga par: spanska titlar landade på
    ~0.38-0.39 "andel spanska stoppord", engelska på 0.0-0.05 -- tydlig
    marginal för trösklarna nedan.
  - Kategorier kan vara FLERA per post (t.ex. {'Do Right + Do Good',
    'Heavenly'}, verifierat live) -- lagras som text[], inte en enda sträng.

UPPHOVSRÄTT (hård regel, se handoffen): den här modulen hämtar ALDRIG en
release i fulltext, kör ALDRIG ett content_type genom AI-artikelpipelinen,
och hotlänkar bilder i stället för att spegla dem. Bara listningssidans
egen teaser sparas, ordagrant.

INKREMENTELL vs. BACKFILL: den här parsern (körs via scrapers.runner,
samma refresh_minutes-spärr som jobs/traffic/school_alerts) är BARA
inkrementell -- hämtar framåt från sida 1 tills en hel sida inte gav någon
ny URL, med ett litet sidtak som skydd. Den engångs-historiska backfillen
(24 månader bakåt) är en SEPARAT, manuellt körd operation
(scripts/backfill_vail_news.py) som medvetet INTE går via runner.py/
refresh_minutes -- den är inte schemalagd och ska bara köras en gång.
"""
from __future__ import annotations

import os
import re
import time
from datetime import date, datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from db.db import content_hash, get_conn
from scrapers.base_parser import BaseParser, FetchResult

BASE_URL = "https://news.vailresorts.com"
LISTING_PATH = "/news-and-stories"
_PAGE_MARKER = "\n<!--VAIL-NEWS-PAGE-->\n"

_ES_STOPWORDS = {
    "de", "la", "el", "los", "una", "se", "del", "en", "con", "para",
    "las", "un", "que", "por", "su", "al", "sus", "como", "más", "este",
}
_SPANISH_THRESHOLD = 0.10
_ENGLISH_THRESHOLD = 0.08


class VailNewsParser(BaseParser):
    table = "vail_news"
    platform = "vail_news"
    conflict_columns = ("town_id", "external_url")
    update_columns = ["title", "categories", "teaser", "image_url", "image_source",
                       "is_translation", "content_hash"]

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get(
            "USER_AGENT", "broomfieldview.com (contact: hello@broomfieldview.com)")}

    def _fetch_page(self, offset: int, page_size: int) -> str:
        url = f"{BASE_URL}{LISTING_PATH}?o={offset}&l={page_size}"
        r = requests.get(url, headers=self._headers(), timeout=30)
        r.raise_for_status()
        return r.text

    def _existing_urls(self) -> set[str]:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT external_url FROM vail_news WHERE town_id=%s", (self.town_id,))
            return {row[0] for row in cur.fetchall()}

    def _recent_english_dates(self) -> list[date]:
        # Nyligen sedda IKKE-översatta poster -- används för att para ihop en
        # spansk post mot en engelsk motsvarighet som skrapades i en TIDIGARE
        # körning (inte bara samma batch, se _flag_translations).
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT published_at FROM vail_news
                    WHERE town_id=%s AND is_translation=false
                      AND published_at >= now() - interval '10 days'""",
                (self.town_id,),
            )
            return [row[0] for row in cur.fetchall()]

    def fetch(self) -> FetchResult:
        page_size = 25
        max_pages = 4  # skyddstak -- Vail publicerar bara några ggr/månad,
        # 4*25=100 poster täcker en flera-månader-lång driftstopp med marginal.
        existing = self._existing_urls()

        pages: list[str] = []
        offset = 0
        for i in range(max_pages):
            if i > 0:
                time.sleep(2)  # minst 2s mellan anrop, se handoffens rate limit
            html = self._fetch_page(offset, page_size)
            pages.append(html)
            items = _extract_items(html)
            if not items:
                break
            new_on_page = [it for it in items if it["url"] not in existing]
            if not new_on_page:
                break
            offset += page_size

        combined = _PAGE_MARKER.join(pages)
        return FetchResult(raw=combined.encode("utf-8"), content_type="text/html",
                            url=f"{BASE_URL}{LISTING_PATH}", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        pages = fetched.raw.decode("utf-8").split(_PAGE_MARKER)
        raw_items: list[dict] = []
        seen_urls: set[str] = set()
        for html in pages:
            for it in _extract_items(html):
                if it["url"] in seen_urls:
                    continue
                seen_urls.add(it["url"])
                raw_items.append(it)

        parsed = []
        for it in raw_items:
            published_at = _parse_date(it["date_text"])
            if published_at is None:
                # inget datum att sortera/dedupa mot -- hoppa hellre över än
                # gissa (samma princip som traffic_v1.py:s external_id-koll).
                continue
            parsed.append({**it, "published_at": published_at})

        if not parsed:
            # "Fail loud, not silent" (se handoffen): sidan svarade, men
            # INGET wd_item-block gick att tolka -- listningsmarkupen har
            # sannolikt ändrats. En tom lyckad körning hade tystat ner precis
            # det en människa behöver få veta.
            raise RuntimeError(
                "vail_news: 0 poster kunde tolkas från listningssidan -- "
                "markupen (li.wd_item) har troligen ändrats, inte ett tomt flöde"
            )

        _flag_translations(parsed, self._recent_english_dates())

        rows = []
        for p in parsed:
            rows.append({
                "external_url": p["url"],
                "title": p["title"],
                "published_at": p["published_at"],
                "categories": p["categories"],
                "teaser": p["teaser"],
                "image_url": p["image_url"],
                "image_source": "vailresorts" if p["image_url"] else None,
                "is_translation": p["is_translation"],
                "content_hash": content_hash("vail_news", p["url"], p["title"], p["teaser"]),
            })
        return rows


def _resolve_url(href: str) -> str:
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return urljoin(BASE_URL, href)


def _extract_items(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for li in soup.select("li.wd_item"):
        title_a = li.select_one(".wd_title a")
        if not title_a or not title_a.get("href"):
            continue
        url = _resolve_url(title_a["href"])
        title = title_a.get_text(" ", strip=True)
        if not title:
            continue

        summary_p = li.select_one(".wd_summary p")
        teaser = summary_p.get_text(" ", strip=True) if summary_p else None

        date_div = li.select_one(".wd_date")
        date_text = date_div.get_text(strip=True) if date_div else None

        categories = [a.get_text(strip=True) for a in li.select(".wd_category_link_list a")]
        categories = [c for c in categories if c]

        img = li.select_one(".wd_thumbnail img")
        image_url = _resolve_url(img["src"]) if img and img.get("src") else None

        items.append({
            "url": url, "title": title, "teaser": teaser,
            "date_text": date_text, "categories": categories, "image_url": image_url,
        })
    return items


def _parse_date(date_text: str | None) -> date | None:
    if not date_text:
        return None
    try:
        return datetime.strptime(date_text.strip(), "%b %d, %Y").date()
    except ValueError:
        return None


def _spanish_score(title: str) -> float:
    words = re.findall(r"[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+", title.lower())
    if not words:
        return 0.0
    hits = sum(1 for w in words if w in _ES_STOPWORDS)
    return hits / len(words)


def _flag_translations(parsed: list[dict], recent_english_dates: list[date]) -> None:
    """Se moduldocstring: inget lang-attribut finns någonstans i källan, så
    det här (stoppordsfrekvens + datumnärhet) är den enda faktiska metoden,
    inte en fallback. Flaggar (is_translation=True), tar aldrig bort raden --
    en felflaggning är då återställningsbar utan ny skrapning."""
    for item in parsed:
        item["is_translation"] = False
        if _spanish_score(item["title"]) < _SPANISH_THRESHOLD:
            continue
        # ser spansk ut -- bekräfta att en engelsk post finns inom ±1 dag,
        # antingen i SAMMA batch eller i redan sparade poster.
        paired = False
        for other in parsed:
            if other is item:
                continue
            if (abs((other["published_at"] - item["published_at"]).days) <= 1
                    and _spanish_score(other["title"]) < _ENGLISH_THRESHOLD):
                paired = True
                break
        if not paired:
            for d in recent_english_dates:
                if abs((d - item["published_at"]).days) <= 1:
                    paired = True
                    break
        item["is_translation"] = paired
