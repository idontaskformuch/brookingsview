"""County-möten via CivicEngage / CivicPlus Agenda Center.

Bygger på det etablerade open source-biblioteket `civic-scraper` (Big Local News),
som redan vet hur man tolkar CivicPlus Agenda Center-sidor (CivicEngage är CivicPlus
produktnamn för kommunwebbplatser) — det ger strukturerad metadata istället för att
vi gissar oss fram till HTML/AJAX-strukturen på en sajt vi bara sett en gång.

Flöde:
  1. civic_scraper.CivicPlusSite(url).scrape(start_date, end_date)
     -> lista av Asset (agenda/minutes-länkar + möte, kommitté, datum)
  2. Vi grupperar assets per möte (kommitté + datum) till en rad i `meetings`.
  3. Om möjligt: ladda ner agenda-PDF:en och extrahera text med pdfplumber, så
     AI-lagret senare kan sammanfatta EXTRAKTIVT (håll dig till vad som faktiskt
     står i agendan) istället för att bara ha en länk att gissa utifrån.

Provenienz: vi snapshotar den strukturerade asset-metadatan civic-scraper hittade
(inte rå HTML — biblioteket exponerar inte det utan lokal cache-fil-hantering).
Det räcker gott: varje post har en direkt källa-URL till PDF:en, vilket är den
egentliga bevisbördan.

STAGE 0-status: AgendaCenter-URL:en (brookingscountysd.gov/AgendaCenter) är redan
i configen och inte flaggad som problematisk, men gör ett snabbt --only-test innan
den litas på fullt ut — CivicPlus-sajter varierar i hur mycket JS-rendering som krävs.
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from io import BytesIO

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# CivicPlus-sajter (Akamai) 404:ar på requests default User-Agent
# ("python-requests/x.x") — kräver en webbläsarliknande UA för att släppa igenom.
_PDF_HEADERS = {
    "User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")
}

# hur långt bak/fram vi hämtar möten. County-möten är sällan superfärska, så vi
# tar ett generöst fönster jämfört med Legistar (som redan är strömmande färskt).
DAYS_BACK = 14
DAYS_FORWARD = 45

# hur mycket av agenda-PDF:ens text vi sparar för AI-lagret (guardrails jobbar
# extraktivt mot detta, så mer kontext är bättre, men vi vill inte svälla DB:n).
MAX_AGENDA_TEXT_CHARS = 20_000


class CivicEngageParser(BaseParser):
    table = "meetings"
    platform = "civicengage"

    def fetch(self) -> FetchResult:
        try:
            from civic_scraper.platforms import CivicPlusSite
        except ImportError as exc:
            raise ImportError(
                "civic-scraper saknas — lägg till i requirements.txt (redan gjort) "
                "och kör 'pip install -r requirements.txt'"
            ) from exc

        url = self.source_cfg.get("url")
        if not url:
            raise ValueError("civicengage_agenda_center.url saknas i config (Stage 0)")

        start = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
        end = (date.today() + timedelta(days=DAYS_FORWARD)).isoformat()

        site = CivicPlusSite(url)
        assets = site.scrape(start_date=start, end_date=end)

        # spara på instansen för parse() — se moduldocstring om varför fetch/parse
        # inte kan delas rent upp här (civic-scraper gör nätverk+tolkning i ett svep).
        self._assets = [_asset_to_dict(a) for a in assets]

        raw = json.dumps(self._assets, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=url, http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        assets = getattr(self, "_assets", None)
        if assets is None:
            assets = json.loads(fetched.raw.decode("utf-8"))

        meetings: dict[tuple, dict] = {}
        for a in assets:
            key = (a.get("committee_name"), a.get("meeting_date"), a.get("meeting_id"))
            rec = meetings.setdefault(key, {
                "body": a.get("committee_name"),
                "meeting_date": a.get("meeting_date"),
                "agenda_url": None,
                "minutes_url": None,
                "raw_data": {"assets": [], "place": a.get("place")},
            })
            rec["raw_data"]["assets"].append(a)
            if a.get("asset_type") == "agenda" and not rec["agenda_url"]:
                rec["agenda_url"] = a.get("url")
            elif a.get("asset_type") == "minutes" and not rec["minutes_url"]:
                rec["minutes_url"] = a.get("url")

        out = []
        for (committee, meeting_date, meeting_id), rec in meetings.items():
            # extraktiv PDF-text: bästa möjliga underlag för AI-lagret, extraktivt.
            if rec["agenda_url"]:
                text = _try_extract_pdf_text(rec["agenda_url"])
                if text:
                    rec["raw_data"]["agenda_text"] = text[:MAX_AGENDA_TEXT_CHARS]

            rec["content_hash"] = content_hash(
                "civicengage", committee, meeting_date, meeting_id
            )
            out.append(rec)
        return out


def _asset_to_dict(asset) -> dict:
    """civic-scraper's Asset stödjer attributåtkomst; normalisera till dict."""
    if isinstance(asset, dict):
        return asset
    fields = [
        "url", "asset_name", "committee_name", "place", "state_or_province",
        "asset_type", "meeting_date", "meeting_time", "meeting_id",
        "content_type", "content_length",
    ]
    return {f: getattr(asset, f, None) for f in fields}


def _try_extract_pdf_text(pdf_url: str) -> str | None:
    """Ladda ner + extrahera text ur en agenda. Misslyckas tyst (returnerar None)
    — en trasig/otillgänglig agenda ska inte fälla hela mötesposten, bara sakna extratext.

    CivicPlus Agenda Center serverar två varianter beroende på URL/sajt:
      - en riktig PDF (kan vara skannad/bildbaserad utan textlager — då ger
        pdfplumber inget, vilket är en äkta datakälle-begränsning, inte en bugg)
      - en "?html=true"-vy som är strukturerad HTML (Content-Type: text/html) med
        agendapunkterna i vanliga <div class="item">-block. Den är text-native och
        ofta en BÄTTRE källa än PDF:en när den finns, så vi föredrar den om servern
        säger text/html istället för att blint anta PDF utifrån filändelsen.
    """
    try:
        r = requests.get(pdf_url, timeout=30, headers=_PDF_HEADERS)
        r.raise_for_status()
    except Exception:  # noqa: BLE001 — nätverksfel är best-effort, inte kritiskt
        return None

    content_type = r.headers.get("Content-Type", "")
    if "html" in content_type:
        return _extract_html_agenda_text(r.text)
    return _extract_pdf_bytes_text(r.content)


def _extract_html_agenda_text(html: str) -> str | None:
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return None
    try:
        soup = BeautifulSoup(html, "html.parser")
        container = soup.find(id="divItems") or soup.body or soup
        text = container.get_text("\n", strip=True)
        return text or None
    except Exception:  # noqa: BLE001
        return None


def _extract_pdf_bytes_text(raw: bytes) -> str | None:
    try:
        import pdfplumber
    except ImportError:
        return None
    try:
        text_parts = []
        with pdfplumber.open(BytesIO(raw)) as pdf:
            for page in pdf.pages[:15]:  # rimligt tak för en agenda
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        return "\n".join(text_parts) if text_parts else None
    except Exception:  # noqa: BLE001 — trasig/skannad PDF utan textlager, inte kritiskt
        return None
