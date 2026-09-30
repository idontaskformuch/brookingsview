"""AgendaLink-möten via det dokumenterade REST-API:et
(docs.agendalink.app/docs/agenda-api) -- Broomfield, CO:s City Council-
möten (client slug "broomfield"). Ingen inloggning, inget robots.txt-
förbud (ingen robots.txt alls hittad på api.agendalink.app/sandbox.
agendalink.app/horizon.agendalink.app -- verifierat 2026-08-27).

TVÅ ENDPOINTS ANVÄNDS:
    GET {base_url}/api/session/all/{client_id}
        -> {"data": [ {id, board, room, scheduleTime, scheduleIso,
                        clientId, status, agendaUrl}, ... ]}
    Listar ALLA möten (verifierat: 188 st, 2024-01 t.o.m. 2027-03), ingen
    dokumenterad paginering -- hämtas oflitrerat, fönstras klientsidan (se
    DAYS_BACK/DAYS_FORWARD), samma mönster som escribe_v1.py använder för
    sin kalenderförfrågan.

    GET {base_url}/api/session/agenda/{id}
        -> {"data": {id, scheduleTime, scheduleIso, board: {name, ...},
                      topics: [ {_id, title, votingOption, details,
                                 status, templateTopic, itemNumber,
                                 agendaGroup, attachments, ...} ]}}
    Per-möte detaljanrop -- HÄR finns det faktiska innehållet (memon,
    proklamationer, motiveringar), inte bara mötesmetadata. Utan detta hade
    varje story bara sagt "mötet hölls", vilket substansspärren i publish.py
    (rätt) filtrerar bort -- samma lärdom som escribe_v1/legistar_v1:s egna
    dokstringar beskriver för sina plattformar.

    OBS: "board" har OLIKA form i de två anropen -- en ren sträng i
    /all/-listan ("City Council Regular Meeting"), ett objekt med .name i
    /agenda/{id}-svaret. body-fältet byggs alltid från listans strängvärde,
    aldrig detaljanropets objekt.

topics[].details ÄR EN JSON-STRÄNG, I TVÅ MÖJLIGA FORMER (verifierat live
mot riktiga möten 2026-08-27):
  1. Slate.js rich-text-noder för tomma/mall-fält, t.ex.
     '[{"type":"p","children":[{"text":"Type..."}]}]' -- dessa hör nästan
     alltid till templateTopic=true-poster (skippas, se _extract_topics)
     eller är genuint tomma.
  2. En JSON-strängad HTML-sträng för poster med faktiskt innehåll, t.ex.
     '"<div>...</div>"' (citattecknen är en del av JSON-värdet -- ett
     dubbelt json.loads krävs: en gång för att få ut HTML-strängen, sedan
     HTML-parsing för att få ut läsbar text). Se _extract_text_from_details.

templateTopic=true FILTRERAS BORT: mötets fasta dagordningsskelett
("Pledge of Allegiance", "Review and Approval of Agenda", ...) -- samma
"inget innehållslöst" -princip civicengage_pdf_v1/escribe_v1 redan
tillämpar för sina plattformars motsvarande boilerplate-poster.

DATUM: scheduleIso SER ut som en riktig ISO 8601-instant (UTC, "Z"-suffix),
men fixad 2026-09-30: bekräftat live att den räknas fel tidszon (som om
Broomfield låg i Central time, inte Mountain) -- en konsekvent ~1 timmes
avvikelse mot samma mötes egen scheduleTime-sträng. meeting_date byggs
därför av scheduleTime ("Thursday, December 10, 2026, 7:00 PM", ortens
väggklocka) lokaliserad till configens timezone, inte av scheduleIso --
se _parse_schedule_time()'s docstring för den fulla utredningen.
scheduleIso används bara kvar som grov fönsterfilter i fetch() (se
_parse_schedule_iso) och som sista reservutväg om scheduleTime saknas.

GENERISK FÖR ANDRA STÄDER: bara client_id/base_url är stadsspecifika
(satta i configen). Ingen hårdkodad Broomfield-referens här.

INTE BYGGT ÄN: /api/session/minutes/{id} (godkända protokoll, motsvarande
eSCRIBE:s PostMinutes/meeting_followups.py-flöde) -- ett rimligt nästa steg,
men medvetet utanför den här första versionens scope.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

DAYS_BACK = 60
DAYS_FORWARD = 90

# Hur många per-möte agenda-detaljanrop vi gör per körning -- artigt mot
# servern, samma resonemang och samma värde som escribe_v1.MAX_AGENDA_FETCHES.
MAX_AGENDA_FETCHES = 40
FETCH_DELAY_SECONDS = 0.25
MAX_AGENDA_TEXT_CHARS = 20_000
# En enskild dagordningspunkts memo kan vara mycket långt (ett verkligt
# exempel, en proklamationsmemo, drog över 2000 tecken ren text efter
# HTML-stripping) -- ett tak per punkt hindrar EN punkt från att svälja
# hela agenda_text-budgeten innan senare punkter ens får plats.
MAX_ITEM_DETAILS_CHARS = 2_000


class AgendaLinkParser(BaseParser):
    table = "meetings"
    platform = "agendalink"
    # Ett möte går draft -> review -> published -> completed -> minutes,
    # och kan få fler/ändrade topics under tiden -- samma skäl som
    # escribe_v1 uppdaterar raw_data vid omkörning i stället för att
    # frysa den vid första skrapningen.
    conflict_columns = ("town_id", "content_hash")
    update_columns = ["body", "meeting_date", "agenda_url", "raw_data", "snapshot_id"]

    def _client_id(self) -> str:
        client_id = self.source_cfg.get("client_id")
        if not client_id:
            raise ValueError("agendalink client_id saknas i config (verifiera i Stage 0)")
        return client_id

    def _base_url(self) -> str:
        return self.source_cfg.get("base_url", "https://api.agendalink.app").rstrip("/")

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        base = self._base_url()
        client_id = self._client_id()
        url = f"{base}/api/session/all/{client_id}"
        r = requests.get(url, headers=self._headers(), timeout=30)
        r.raise_for_status()
        meetings = r.json().get("data") or []

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=DAYS_BACK)
        window_end = now + timedelta(days=DAYS_FORWARD)
        candidates = [
            m for m in meetings
            if (dt := _parse_schedule_iso(m.get("scheduleIso"))) is not None
            and window_start <= dt <= window_end
        ]

        fetched_count = 0
        for m in candidates:
            if fetched_count >= MAX_AGENDA_FETCHES:
                break
            meeting_id = m.get("id")
            if not meeting_id:
                continue
            try:
                ar = requests.get(f"{base}/api/session/agenda/{meeting_id}",
                                   headers=self._headers(), timeout=30)
                if ar.status_code == 200:
                    m["_agenda_detail"] = ar.json().get("data")
            except Exception as exc:  # noqa: BLE001 -- en trasig agenda ska inte fälla mötet
                print(f"    [agendalink] kunde inte hämta agenda för möte {meeting_id}: {exc}")
            fetched_count += 1
            time.sleep(FETCH_DELAY_SECONDS)

        self._candidates = candidates
        raw = json.dumps(candidates, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        candidates = getattr(self, "_candidates", None)
        if candidates is None:
            candidates = json.loads(fetched.raw.decode("utf-8"))

        tzname = self.cfg["timezone"]
        out = []
        for m in candidates:
            meeting_id = m.get("id")
            meeting_dt = _parse_schedule_time(m.get("scheduleTime"), tzname)
            if meeting_dt is None:
                # Defensive fallback only -- scheduleTime missing/unparseable
                # is not expected from real data (verified live 2026-08-27
                # and again 2026-09-30), but a wrong-timezone instant still
                # beats losing the meeting entirely.
                meeting_dt = _parse_schedule_iso(m.get("scheduleIso"))
                if meeting_dt is not None:
                    print(f"    [agendalink] möte {meeting_id}: scheduleTime saknas/oparsbar "
                          f"({m.get('scheduleTime')!r}), faller tillbaka på scheduleIso (kan vara "
                          "fel tidszon -- se _parse_schedule_time()'s docstring)")
            detail = m.pop("_agenda_detail", None)

            raw_data = dict(m)
            if detail:
                items = _extract_topics(detail.get("topics") or [])
                if items:
                    raw_data["agenda_items"] = items
                    text = _items_to_text(items)
                    if text:
                        raw_data["agenda_text"] = text[:MAX_AGENDA_TEXT_CHARS]

            out.append({
                "body": m.get("board"),
                "meeting_date": meeting_dt,
                "agenda_url": m.get("agendaUrl"),
                "minutes_url": None,
                "raw_data": raw_data,
                "content_hash": content_hash(
                    "agendalink", meeting_id, m.get("scheduleIso")
                ),
            })
        return out


def _parse_schedule_iso(value: str | None) -> datetime | None:
    """Coarse-only: used solely for fetch()'s generous DAYS_BACK/DAYS_FORWARD
    window filter, where being off by an hour or two never changes which
    meetings fall inside a 60/90-day window. NOT used for the stored
    meeting_date -- see _parse_schedule_time()'s docstring for why."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


_SCHEDULE_TIME_RE = "%A, %B %d, %Y, %I:%M %p"


def _parse_schedule_time(value: str | None, tzname: str) -> datetime | None:
    """The stored meeting_date. AgendaLink's own `scheduleTime` string
    ("Thursday, December 10, 2026, 7:00 PM") is a human-composed local
    wall-clock time -- verified live against real Broomfield data to be the
    RELIABLE field. `scheduleIso` claims to already be a correct UTC
    instant (this module's docstring said so until this fix), but is
    silently computed against the WRONG US timezone: e.g. id 11337's
    scheduleIso (2026-10-14T00:00:00Z) converts to 6:00 PM America/Denver
    on Oct 13 via a correct IANA conversion, but its own scheduleTime says
    "Tuesday, October 13, 2026, 7:00 PM" -- a real, consistent 1-hour
    mismatch (matches scheduleIso being computed as if Broomfield were on
    Central time, not Mountain), an upstream AgendaLink/Horizon quirk, not
    something this scraper introduced. Parsing scheduleTime directly and
    localizing it to the town's OWN configured zone (tzname) sidesteps
    whatever timezone AgendaLink's own scheduleIso computation assumes."""
    if not value:
        return None
    try:
        return datetime.strptime(value, _SCHEDULE_TIME_RE).replace(tzinfo=ZoneInfo(tzname))
    except ValueError:
        return None


_MERGE_FIELD_RE = re.compile(r"\{\{?[a-zA-Z][\w.]*\}\}?")


def _strip_unresolved_merge_fields(text: str) -> str:
    """A meeting still in 'draft' status (see fetch()'s DAYS_FORWARD window --
    far-future meetings are often still drafts) can carry template merge
    tokens ("{{presentedBy}}", "{{meetingDate}}", even a malformed single-
    brace "{presentedBy}" seen live) that never got filled in. Confirmed
    live 2026-08-27: a real draft memo's extracted text read "Presented By:
    {{customField.presentedBy}} ... Meeting Date: {{meetingDate}}" -- not
    something to publish verbatim. Stripped rather than filled in with a
    guess, same "never fabricate a missing value" rule as everywhere else
    in this pipeline."""
    return re.sub(r"\s{2,}", " ", _MERGE_FIELD_RE.sub("", text)).strip()


def _extract_text_from_details(details: str) -> str:
    """`details` is always itself a JSON-encoded string -- either Slate.js
    rich-text block nodes (empty/template fields) or a JSON-strung HTML
    string (real content). See module docstring."""
    if not details:
        return ""
    try:
        parsed = json.loads(details)
    except (TypeError, ValueError):
        return _strip_unresolved_merge_fields(details)
    if isinstance(parsed, str):
        soup = BeautifulSoup(parsed, "html.parser")
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
        return _strip_unresolved_merge_fields(text)
    if isinstance(parsed, list):
        return _strip_unresolved_merge_fields(_slate_to_text(parsed))
    return ""


def _slate_leaf_text(node) -> str:
    if isinstance(node, dict):
        if "text" in node:
            return node["text"]
        if "children" in node:
            return "".join(_slate_leaf_text(c) for c in node["children"])
    return ""


def _slate_to_text(nodes: list) -> str:
    # "Type..." is Slate's own placeholder text for an untouched empty
    # field -- filtered here as a second safety net alongside the
    # templateTopic skip in _extract_topics (a non-template topic could
    # still legitimately have an untouched details field).
    lines = [_slate_leaf_text(n).strip() for n in nodes]
    return "\n".join(l for l in lines if l and l != "Type...")


def _extract_topics(topics: list[dict]) -> list[dict]:
    items = []
    for t in topics:
        if t.get("templateTopic"):
            continue
        title = (t.get("title") or "").strip()
        if not title:
            continue
        details_text = _extract_text_from_details(t.get("details") or "")[:MAX_ITEM_DETAILS_CHARS]
        items.append({
            "item_number": t.get("itemNumber"),
            "agenda_group": t.get("agendaGroup"),
            "title": title,
            "details": details_text,
            "voting_option": t.get("votingOption"),
        })
    return items


def _items_to_text(items: list[dict]) -> str:
    """Platta ut agendan till läsbar text för AI-lagret, samma mönster som
    escribe_v1._items_to_text/legistar_v1._items_to_text."""
    lines = []
    for item in items:
        parts = [item.get("agenda_group") or "", item["title"]]
        if item.get("details"):
            parts.append(f"-- {item['details']}")
        lines.append(" ".join(p for p in parts if p).strip())
    return "\n".join(lines)
