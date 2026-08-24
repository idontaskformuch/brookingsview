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
import re
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

        # "ACTION SUMMARY" (see _find_action_summary_pdf_url) -- a per-
        # agenda-item outcome record, structured enough to parse
        # deterministically (see _parse_action_summary), unlike PostMinutes'
        # narrative prose. Verified live 2026-08-24 against Moreno Valley's
        # eSCRIBE portal: posted for City Council Regular Meetings alongside
        # PostMinutes; Planning Commission meetings never carry either
        # document type there (checked ~20 real Planning Commission
        # meetings spanning Oct 2025-Aug 2026, zero had one) -- see
        # NEEDS-HUMAN-REVIEW.md, "Week 3 -- City Hall Project Pages" for the
        # full verification. Separate counter from the minutes loop above,
        # same reasoning.
        action_summary_fetched = 0
        for m in meetings:
            if action_summary_fetched >= MAX_AGENDA_FETCHES:
                break
            action_summary_url = _find_action_summary_pdf_url(m, base)
            if not action_summary_url:
                continue
            try:
                asr = requests.get(action_summary_url, headers=self._headers(), timeout=30)
                if asr.status_code == 200:
                    m["_action_summary_text"] = _extract_pdf_text(asr.content, max_chars=_MAX_ACTION_SUMMARY_TEXT_CHARS)
                    m["_action_summary_url"] = action_summary_url
            except Exception as exc:  # noqa: BLE001 -- ett trasigt action summary-dokument ska inte fälla mötet
                print(f"    [escribe] kunde inte hämta action summary för möte {m.get('ID')}: {exc}")
            action_summary_fetched += 1
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
            action_summary_text = m.pop("_action_summary_text", None)
            action_summary_url = m.pop("_action_summary_url", None)
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
            if action_summary_text:
                action_items = _parse_action_summary(action_summary_text)
                if action_items:
                    raw_data["action_summary_items"] = action_items
                    raw_data["action_summary_url"] = action_summary_url

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
# Action Summary is a densely-packed, one-block-per-agenda-item record (see
# _parse_action_summary) -- a real 38-item meeting ran 34,594 characters,
# and the items that matter most for project tracking (public-hearing/
# development items) tend to sort LATE in a meeting's agenda, not early.
# The 20,000-char minutes limit above would have silently truncated that
# real meeting mid-document, dropping exactly the items worth tracking --
# caught in testing, not assumed safe. Generous margin over the observed
# real-world size.
_MAX_ACTION_SUMMARY_TEXT_CHARS = 80_000


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


def _find_action_summary_pdf_url(meeting: dict, base: str) -> str | None:
    """The "ACTION SUMMARY" document -- an eSCRIBE AdditionalDocuments entry
    (there's no dedicated Type for it, unlike PostMinutes), identified by
    its Title. One repeating block per agenda item (Agenda Number/Title/
    Moved by/Seconded by/vote tally/RESULT), verified live against a real
    meeting to be far more reliably parseable per-item than PostMinutes'
    narrative prose -- see _parse_action_summary() and
    NEEDS-HUMAN-REVIEW.md, "Week 3 -- City Hall Project Pages"."""
    for doc in meeting.get("MeetingDocumentLink") or []:
        if doc.get("Type") == "AdditionalDocuments" and "ACTION SUMMARY" in (doc.get("Title") or "").upper():
            url = doc.get("Url")
            if url:
                return url if url.startswith("http") else f"{base}{url}"
    return None


_ACTION_SUMMARY_AGENDA_NUMBER_RE = re.compile(r"Agenda Number:\s*([^\n]+)")
_ACTION_SUMMARY_TITLE_RE = re.compile(r"Title:\s*(.+?)\n(?=Date:)", re.DOTALL)
_ACTION_SUMMARY_RESULT_RE = re.compile(r"RESULT:\s*(\S+)")
_ACTION_SUMMARY_VOTE_RE = re.compile(
    r"YES:\s*(\d+)\s+NO:\s*(\d+)\s+ABSTAIN:\s*(\d+)\s+CONFLICT:\s*(\d+)\s+ABSENT:\s*(\d+)"
)


def _parse_action_summary(text: str) -> list[dict]:
    """One dict per agenda item: {counter, title, result, vote}. `result` is
    None (never guessed) when the block has no RESULT line at all -- some
    items (e.g. a "receive and file" report) are informational only, with
    no motion/vote to record. `vote` is only present when the single
    combined "YES: N NO: N ABSTAIN: N CONFLICT: N ABSENT: N" tally line is
    found -- the SAME five-number line eSCRIBE always emits once per item,
    distinct from the per-member roster lines that can follow it (which
    this regex does not match, since it requires all five labels on one
    line). Verified against a real 38-item meeting: 38/38 items parsed,
    including a genuine non-unanimous 4-1 vote and one item with no
    RESULT/vote at all (correctly left as result=None, not guessed)."""
    blocks = re.split(r"\n?Action Summary\n", text)
    items = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        counter_m = _ACTION_SUMMARY_AGENDA_NUMBER_RE.search(block)
        title_m = _ACTION_SUMMARY_TITLE_RE.search(block)
        if not counter_m or not title_m:
            continue
        result_m = _ACTION_SUMMARY_RESULT_RE.search(block)
        vote_m = _ACTION_SUMMARY_VOTE_RE.search(block)
        item = {
            "counter": counter_m.group(1).strip(),
            "title": re.sub(r"\s+", " ", title_m.group(1)).strip(),
            "result": result_m.group(1).strip() if result_m else None,
        }
        if vote_m:
            item["vote"] = {
                k: int(v) for k, v in zip(("yes", "no", "abstain", "conflict", "absent"), vote_m.groups())
            }
        items.append(item)
    return items


def _extract_pdf_text(raw: bytes, max_chars: int = _MAX_MINUTES_TEXT_CHARS) -> str | None:
    import pdfplumber
    from io import BytesIO

    try:
        with pdfplumber.open(BytesIO(raw)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        text = "\n".join(pages).strip()
        return text[:max_chars] or None
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
