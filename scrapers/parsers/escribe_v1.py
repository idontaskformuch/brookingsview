"""eSCRIBE-möten via de dokumenterade AJAX-anrop sajtens egen frontend använder.

eSCRIBE (Granicus/Legistar-konkurrent, används enligt egen marknadsföring av
"hundratals" kommunsekreterare) exponerar inget publikt REST-API som Legistars
webapi.legistar.com, men den publika mötesportalen (t.ex.
pub-<kommun>.escribemeetings.com) är en ASP.NET WebForms-sajt vars egen
kalendervy anropar ett dokumenterat "page method":

    POST {base_url}/MeetingsCalendarView.aspx/GetCalendarMeetings
    Content-Type: application/json
    body: {"calendarStartDate": "YYYY-MM-DD", "calendarEndDate": "YYYY-MM-DD"}
    -> {"d": [ {ID, MeetingName, StartDate, ..., MeetingDocumentLink: [...]} ]}

Detta är ASP.NET:s vanliga mönster för AJAX-aktiverade sidmetoder, inte ett
skrap-workaround. Verifierat live 2026-07-23 mot
pub-morenovalley.escribemeetings.com: ingen robots.txt-begränsning, fungerar
med sajtens vanliga User-Agent-konvention (ingen webbläsarmaskering krävs --
ett anrop utan User-Agent alls gav också 200, men vi sätter den ändå av artighet
och konsekvens med resten av pipelinen).

VARFÖR AGENDA-HTML OCH INTE PDF: varje möte med HasAgenda=true har en HTML-vy
av agendan på
    {base_url}/Meeting.aspx?Id={meeting_id}&Agenda=Agenda&lang=English
Den är server-renderad (agendapunkterna finns i själva HTML-svaret, inte
efterladdade via JS) i <div class='AgendaItemContainer'>-block: en rubrikrad
(.AgendaItemCounter + .AgendaItemTitle), en valfri beskrivning
(.AgendaItemDescription) och en valfri rekommendation (.MotionText). Text-native,
ingen PDF-extraktion behövs -- samma princip som civicengage_pdf_v1.py:s
"?html=true"-preferens, och samma skäl som legistar_v1.py:s eventitems: bara
mötesmetadata ("residents can review the full agenda online") ger innehållslösa
stories som substansspärren i publish.py (rätt) filtrerar bort, vilket gjorde
kommunfullmäktige tyst på sajten tills legistar_v1 hämtade agendapunkter också.

DATUMFORMAT: eSCRIBE:s StartDate kommer som "YYYY/MM/DD HH:MM:SS" (snedstreck,
inte ISO). Skickas det som en rå sträng till en TIMESTAMPTZ-kolumn är tolkningen
beroende av Postgres DateStyle-inställning -- riskabelt. Parsas därför till ett
riktigt datetime-objekt innan det når DB-lagret, samma försiktighet som
formatCalendarDate på frontend-sidan hanterar möteskalenderdatum utan tvetydighet.

GENERISK FÖR ANDRA STÄDER: bara base_url är stadsspecifik (satt i configen).
Ingen hårdkodad Moreno Valley-referens här -- nästa stad som kör eSCRIBE
(vanlig plattform) återanvänder denna parser rakt av.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# Möten hämtas för ett fönster runt idag, likt civicengage_pdf_v1 (Legistars
# API strömmar redan färskt framåt via sortering, men eSCRIBE:s kalenderanrop
# vill ha ett explicit datumintervall).
#
# DAYS_BACK vidgades 60 (från 14) 2026-08-22 för att fånga PostMinutes (se
# _find_minutes_pdf_url och ai_pipeline/meeting_followups.py): verifierat
# live att en 2026-07-30-möte fortfarande INTE hade minutes postade så sent
# som 2026-08-18 (14 dagar back-fönstret hade redan tappat mötet då), men
# HADE det senast 2026-08-22 -- minutes-eftersläpningen är alltså längre än
# 14 dagar men mindre än ~3 veckor för den här kommunen, så 60 dagars marginal
# är rejält säkert utan att svälla möteslistan orimligt (eSCRIBE har typiskt
# < 2 möten/vecka för Moreno Valley).
DAYS_BACK = 60
DAYS_FORWARD = 45

# hur många möten vi hämtar agenda-HTML för per körning -- artigt mot servern,
# samma resonemang som legistar_v1:s MAX_AGENDA_FETCHES.
MAX_AGENDA_FETCHES = 40
FETCH_DELAY_SECONDS = 0.25
MAX_AGENDA_TEXT_CHARS = 20_000


class EscribeParser(BaseParser):
    table = "meetings"
    platform = "escribe"
    # content_hash is stable per meeting (see content_hash() call in parse()
    # -- built from meeting_id + date only, never from agenda/minutes text),
    # so it doubles as a safe identity for DO UPDATE. Needed so a meeting
    # already inserted with an agenda gets its raw_data refreshed once
    # PostMinutes shows up days later within the DAYS_BACK re-fetch window
    # -- the default (town_id, content_hash) DO NOTHING would otherwise
    # silently freeze that row at its agenda-only state forever. See
    # ai_pipeline/meeting_followups.py, which reads minutes_text from here.
    conflict_columns = ("town_id", "content_hash")
    update_columns = ["body", "meeting_date", "agenda_url", "minutes_url", "raw_data", "snapshot_id"]

    def _base_url(self) -> str:
        base = self.source_cfg.get("base_url")
        if not base:
            raise ValueError("escribe base_url saknas i config (verifiera i Stage 0)")
        return base.rstrip("/")

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        base = self._base_url()
        start = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
        end = (date.today() + timedelta(days=DAYS_FORWARD)).isoformat()

        url = f"{base}/MeetingsCalendarView.aspx/GetCalendarMeetings"
        r = requests.post(
            url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json={"calendarStartDate": start, "calendarEndDate": end},
            timeout=30,
        )
        r.raise_for_status()
        meetings = r.json().get("d") or []

        # hämta agenda-HTML per möte som faktiskt har en -- det är där
        # innehållet finns, se moduldocstring.
        fetched_count = 0
        for m in meetings:
            if not m.get("HasAgenda") or fetched_count >= MAX_AGENDA_FETCHES:
                continue
            agenda_url = _find_html_agenda_url(m, base)
            if not agenda_url:
                continue
            try:
                ar = requests.get(agenda_url, headers=self._headers(), timeout=30)
                if ar.status_code == 200:
                    m["_agenda_html"] = ar.text
            except Exception as exc:  # noqa: BLE001 -- en trasig agenda ska inte fälla mötet
                print(f"    [escribe] kunde inte hämta agenda för möte {m.get('ID')}: {exc}")
            fetched_count += 1
            time.sleep(FETCH_DELAY_SECONDS)

        # PostMinutes ("what actually happened", see ai_pipeline/
        # meeting_followups.py) dyker upp DAGAR efter mötet -- separat
        # räknare/gräns från agendan ovan så en sen minutes-körning aldrig
        # konkurrerar med agenda-hämtningen om samma MAX_AGENDA_FETCHES-tak.
        minutes_fetched = 0
        for m in meetings:
            if minutes_fetched >= MAX_AGENDA_FETCHES:
                break
            minutes_url = _find_minutes_pdf_url(m, base)
            if not minutes_url:
                continue
            try:
                mr = requests.get(minutes_url, headers=self._headers(), timeout=30)
                if mr.status_code == 200:
                    # Extracted to text HERE, not carried as raw bytes --
                    # the fetch()-level snapshot below is JSON (bytes
                    # aren't serializable, and a mid-size PDF would bloat
                    # source_snapshots for no benefit over the text itself).
                    m["_minutes_text"] = _extract_pdf_text(mr.content)
                    m["_minutes_url"] = minutes_url
            except Exception as exc:  # noqa: BLE001 -- trasiga minutes ska inte fälla mötet
                print(f"    [escribe] kunde inte hämta minutes för möte {m.get('ID')}: {exc}")
            minutes_fetched += 1
            time.sleep(FETCH_DELAY_SECONDS)

        self._meetings = meetings
        raw = json.dumps(meetings, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        meetings = getattr(self, "_meetings", None)
        if meetings is None:
            meetings = json.loads(fetched.raw.decode("utf-8"))

        base = self._base_url()
        out = []
        for m in meetings:
            meeting_id = m.get("ID")
            agenda_html = m.pop("_agenda_html", None)
            minutes_text = m.pop("_minutes_text", None)
            minutes_url = m.pop("_minutes_url", None)
            meeting_dt = _parse_escribe_date(m.get("StartDate"))

            raw_data = dict(m)
            if agenda_html:
                items = _extract_agenda_items(agenda_html)
                if items:
                    raw_data["agenda_items"] = items
                    text = _items_to_text(items)
                    if text:
                        raw_data["agenda_text"] = text[:MAX_AGENDA_TEXT_CHARS]
            if minutes_text:
                raw_data["minutes_text"] = minutes_text[:MAX_AGENDA_TEXT_CHARS]

            out.append({
                "body": m.get("MeetingName"),
                "meeting_date": meeting_dt,
                "agenda_url": _find_public_agenda_url(m, base),
                "minutes_url": minutes_url,
                "raw_data": raw_data,
                "content_hash": content_hash(
                    "escribe", meeting_id, meeting_dt.isoformat() if meeting_dt else m.get("StartDate")
                ),
            })
        return out


_MAX_MINUTES_TEXT_CHARS = 20_000


def _find_minutes_pdf_url(meeting: dict, base: str) -> str | None:
    """"PostMinutes" is eSCRIBE's document type for approved/posted minutes --
    verified live 2026-08-22 against a real past meeting (2026/07/30 City
    Council Special Meeting): shows up in MeetingDocumentLink days after the
    meeting, once staff post it, same as HasAgenda flips on when an agenda
    is ready. Unlike the Agenda documents there's no HTML rendition offered,
    only PDF -- extracted with pdfplumber, same as civicengage_pdf_v1.py.
    Url comes back relative ("/FileStream.ashx?DocumentId=...") -- same
    base-prefixing _find_html_agenda_url already does for Agenda links."""
    for doc in meeting.get("MeetingDocumentLink") or []:
        if doc.get("Type") == "PostMinutes":
            url = doc.get("Url")
            if url:
                return url if url.startswith("http") else f"{base}{url}"
    return None


def _extract_pdf_text(raw: bytes) -> str | None:
    import pdfplumber
    from io import BytesIO

    try:
        with pdfplumber.open(BytesIO(raw)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        text = "\n".join(pages).strip()
        return text[:_MAX_MINUTES_TEXT_CHARS] or None
    except Exception:  # noqa: BLE001 -- a malformed PDF is a real data-source limitation, not a bug
        return None


def _parse_escribe_date(value: str | None) -> datetime | None:
    """eSCRIBE ger 'YYYY/MM/DD HH:MM:SS' -- ett riktigt datetime-objekt undviker
    all tvetydighet kring hur Postgres DateStyle skulle tolka en rå sträng."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y/%m/%d %H:%M:%S")
    except ValueError:
        return None


def _find_html_agenda_url(meeting: dict, base: str) -> str | None:
    """Text-native HTML-agendavyn, för extraktion av dagordningspunkter."""
    for doc in meeting.get("MeetingDocumentLink") or []:
        if doc.get("Type") == "Agenda" and doc.get("Format") == "HTML":
            url = doc.get("Url")
            if url:
                return url if url.startswith("http") else f"{base}{url}"
    return None


def _find_public_agenda_url(meeting: dict, base: str) -> str | None:
    """Länken som visas för läsaren i publicerade stories -- föredrar samma
    HTML-agenda (renderas direkt i webbläsaren), sen PDF, sen mötets egen sida."""
    docs = meeting.get("MeetingDocumentLink") or []
    for doc in docs:
        if doc.get("Type") == "Agenda" and doc.get("Format") == "HTML":
            url = doc.get("Url")
            if url:
                return url if url.startswith("http") else f"{base}{url}"
    for doc in docs:
        if doc.get("Type") == "Agenda":
            url = doc.get("Url")
            if url:
                return url if url.startswith("http") else f"{base}{url}"
    return meeting.get("Url")


def _extract_agenda_items(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for row in soup.select(".AgendaItemTitleRow"):
        title_el = row.select_one(".AgendaItemTitle")
        if not title_el:
            continue
        title = title_el.get_text(" ", strip=True)
        if not title:
            continue
        counter_el = row.select_one(".AgendaItemCounter")
        counter = counter_el.get_text(" ", strip=True) if counter_el else ""

        parent = row.find_parent(class_="AgendaItem")
        description = ""
        motion = ""
        if parent:
            desc_el = parent.select_one(".AgendaItemDescription")
            if desc_el:
                description = desc_el.get_text(" ", strip=True)
            motion_el = parent.select_one(".MotionText")
            if motion_el:
                motion = motion_el.get_text(" ", strip=True)
        items.append({"counter": counter, "title": title, "description": description, "motion": motion})
    return items


def _items_to_text(items: list[dict]) -> str:
    """Platta ut agendan till läsbar text för AI-lagret, samma mönster som
    legistar_v1._items_to_text. Rent procedurella punkter (upprop, ajournering)
    blir korta av sig själva -- substansspärren i publish.py filtrerar bort dem
    naturligt utan en skiplista att underhålla."""
    lines: list[str] = []
    for item in items:
        parts = [item["counter"], item["title"]]
        if item["description"]:
            parts.append(f"-- {item['description']}")
        if item["motion"]:
            parts.append(f"Recommendation: {item['motion']}")
        lines.append(" ".join(p for p in parts if p).strip())
    return "\n".join(lines)
