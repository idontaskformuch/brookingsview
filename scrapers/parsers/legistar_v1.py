"""Legistar-möten via den dokumenterade WebAPI:n, inklusive dagordningspunkter.

Legistar (Granicus) exponerar ett publikt REST-API:
    https://webapi.legistar.com/v1/{client}/events
    https://webapi.legistar.com/v1/{client}/events/{EventId}/eventitems
Detta är stabilare än att skrapa HTML och återanvänds RAKT AV för varje framtida
ort som kör Legistar (mycket vanligt i USA) -- bara client_id byts i configen.

VARFÖR EVENTITEMS: den första versionen hämtade bara mötets metadata (organ, datum,
agenda-URL). Det gav innehållslösa stories -- "residents can review the full agenda
online" -- eftersom AI-lagret inte hade något att arbeta med. Substansspärren i
publish.py filtrerade bort dem, vilket var rätt men gjorde kommunfullmäktige helt
tyst på sajten. Dagordningspunkterna är själva nyheten: variansansökningar,
bygglov, upphandlingar, namngivna ärenden. De hämtas nu per möte och sätts som
raw_data.agenda_text, samma fält som civicengage_pdf_v1 fyller från PDF-agendor,
så publish.py och guardrails behandlar båda källorna identiskt.

Fältnamn verifierade mot Granicus egen API-dokumentation (webapi.legistar.com/Help).
"""
from __future__ import annotations

import os

import json
import time
from datetime import datetime, timedelta

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

WEBAPI = "https://webapi.legistar.com/v1"

# hur många möten vi hämtar dagordning för per körning. Varje möte = ett extra
# HTTP-anrop, så vi håller det artigt mot Granicus servrar.
MAX_AGENDA_FETCHES = 40
FETCH_DELAY_SECONDS = 0.25

MAX_AGENDA_TEXT_CHARS = 20_000

# Phase 7 ("Decisions"): röster hämtas bara för ärenden som faktiskt KAN ha
# en registrerad omröstning -- ett eget Matter (EventItemMatterId) OCH en
# satt Pass/Fail-flagga (EventItemPassedFlagName). Rena procedurpunkter
# (upprop, ajournering, dagordningsrubriker) har varken och hoppas över --
# verifierat live mot cityofbrookings: av ~35 punkter per möte har bara
# ~10-15 båda, så detta håller anropsvolymen nere utan att gissa bort någon
# riktig omröstning.
MAX_VOTE_FETCHES_PER_MEETING = 30


class LegistarParser(BaseParser):
    table = "meetings"
    platform = "legistar"
    # Phase 7 ("Decisions"): EventItemPassedFlagName/votes genuinely change
    # AFTER a meeting happens -- a scrape right after it sees no result yet
    # (outcome='pending', "On the agenda"); a later rescrape of the SAME
    # EventId sees the posted result. content_hash is computed from
    # (platform, event_id, date_str) alone and deliberately does NOT change
    # when that happens (the meeting's own identity is stable) -- without
    # this, the default "DO NOTHING on conflict" (see db.upsert_records()'s
    # own docstring) would freeze raw_data at whatever it looked like on
    # first scrape, forever, and no agenda item could ever move from "On
    # the agenda" to "Decided". Verified live this was a real, not
    # theoretical, bug: a one-off rescrape with the new vote-fetching code
    # produced "0 new rows" and left raw_data completely unchanged before
    # this fix. Same pattern this codebase already uses for a live-scoring
    # sports match.
    update_columns = ["raw_data", "agenda_url", "minutes_url"]
    # QA finding (2026-10-15, live data loss): Legistar stops exposing
    # EventItem-level detail for an event once it's old enough (confirmed
    # live, ~51-58 days) -- a rescrape then returns zero items, and
    # without this, the blind replace above would erase the richer
    # historical agenda_items/agenda_text permanently. See db.upsert_
    # records()'s own merge_raw_data doc comment for the full tradeoff.
    merge_raw_data = True
    # The source's own id is the meeting's identity, not content_hash (which
    # changes whenever its inputs do -- Moreno Valley got 13+ duplicate rows
    # that way, 2026-10-01 and again 10-15/10-20). See db.upsert_records().
    identity_key = "EventId"

    def _client(self) -> str:
        client = self.source_cfg.get("client_id")
        if not client:
            raise ValueError("legistar client_id saknas i config (verifiera i Stage 0)")
        return client

    def _headers(self) -> dict:
        return {
            "Accept": "application/json",
            "User-Agent": user_agent(self.town_id),
        }

    # Phase 7 ("Decisions"): 30 dagar var för kort -- mätning mot
    # source_snapshots-historiken visade p95 outcome-lag ~607h (~25 dagar),
    # och 45% av ärendena var högercensurerade exakt vid den gamla
    # 30-dagarsgränsen (aldrig omdragna, inte nödvändigtvis fast för alltid).
    # 60 dagar ger marginal över p95 utan att dra in ett helt års historik.
    FETCH_WINDOW_DAYS = 60

    def fetch(self) -> FetchResult:
        client = self._client()
        since = (datetime.utcnow() - timedelta(days=self.FETCH_WINDOW_DAYS)).strftime("%Y-%m-%dT00:00:00")
        params = {
            "$filter": f"EventDate ge datetime'{since}'",
            "$orderby": "EventDate desc",
            "$top": "50",
        }
        url = f"{WEBAPI}/{client}/events"
        r = requests.get(url, params=params, timeout=30, headers=self._headers())
        r.raise_for_status()
        events = r.json()

        # hämta dagordningspunkter per möte -- det är där det faktiska innehållet finns.
        # docs_attempted/docs_failed: se FetchResult-fältens docstring --
        # tidigare försvann en trasig hämtning in i en print(), aldrig synlig
        # i scrape_runs.
        docs_attempted = 0
        docs_failed = 0
        docs_last_error: str | None = None
        for event in events[:MAX_AGENDA_FETCHES]:
            event_id = event.get("EventId")
            if not event_id:
                continue
            docs_attempted += 1
            try:
                items_url = f"{WEBAPI}/{client}/events/{event_id}/eventitems"
                ir = requests.get(items_url, params={"AgendaNote": "1"},
                                  timeout=30, headers=self._headers())
                if ir.status_code == 200:
                    items = ir.json()
                    event["_agenda_items"] = items
                    votes_fetched = 0
                    for item in items:
                        if votes_fetched >= MAX_VOTE_FETCHES_PER_MEETING:
                            break
                        if not item.get("EventItemMatterId") or not item.get("EventItemPassedFlagName"):
                            continue
                        votes_fetched += 1
                        docs_attempted += 1
                        item_id = item.get("EventItemId")
                        try:
                            vr = requests.get(
                                f"{WEBAPI}/{client}/eventitems/{item_id}/votes",
                                timeout=30, headers=self._headers(),
                            )
                            if vr.status_code == 200:
                                item["_votes"] = vr.json()
                            else:
                                docs_failed += 1
                                docs_last_error = f"votes HTTP {vr.status_code} (item {item_id})"
                        except Exception as exc:  # noqa: BLE001 -- en trasig röstlista ska inte fälla mötet
                            docs_failed += 1
                            docs_last_error = f"votes: {exc} (item {item_id})"
                            print(f"    [legistar] kunde inte hämta röster för item {item_id}: {exc}")
                        time.sleep(FETCH_DELAY_SECONDS)
                else:
                    docs_failed += 1
                    docs_last_error = f"eventitems HTTP {ir.status_code} (event {event_id})"
            except Exception as exc:  # noqa: BLE001 -- en trasig agenda ska inte fälla mötet
                docs_failed += 1
                docs_last_error = f"eventitems: {exc} (event {event_id})"
                print(f"    [legistar] kunde inte hämta agenda för event {event_id}: {exc}")
            time.sleep(FETCH_DELAY_SECONDS)

        self._events = events
        raw = json.dumps(events, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json",
                           url=r.url, http_code=r.status_code,
                           docs_attempted=docs_attempted, docs_failed=docs_failed,
                           docs_last_error=docs_last_error)

    def parse(self, fetched: FetchResult) -> list[dict]:
        events = getattr(self, "_events", None)
        if events is None:
            events = json.loads(fetched.raw.decode("utf-8"))

        out = []
        for e in events:
            event_id = e.get("EventId")
            date_str = e.get("EventDate")
            items = e.get("_agenda_items") or []

            raw_data = {k: v for k, v in e.items() if k != "_agenda_items"}
            if items:
                raw_data["agenda_items"] = [_clean_item(i) for i in items]
                agenda_text = _items_to_text(items)
                if agenda_text:
                    raw_data["agenda_text"] = agenda_text[:MAX_AGENDA_TEXT_CHARS]

            out.append({
                "body": e.get("EventBodyName"),
                "meeting_date": date_str,
                "agenda_url": e.get("EventAgendaFile"),
                "minutes_url": e.get("EventMinutesFile"),
                "raw_data": raw_data,
                "content_hash": content_hash("legistar", event_id, date_str),
            })
        return out


def _clean_item(item: dict) -> dict:
    """Behåll bara de fält som säger något om vad ärendet handlar om."""
    keep = (
        "EventItemAgendaNumber", "EventItemTitle", "EventItemActionText",
        "EventItemActionName", "EventItemMatterFile", "EventItemMatterName",
        "EventItemMatterType", "EventItemMatterStatus", "EventItemAgendaNote",
    )
    cleaned = {k: item.get(k) for k in keep if item.get(k)}

    # Phase 7 ("Decisions"): id/flagga/matter-id behålls OVILLKORLIGT (till
    # skillnad från `keep` ovan) -- EventItemConsent=0 och
    # EventItemPassedFlag=0 är giltiga, meningsfulla värden som `if
    # item.get(k)` (sant för `keep`) felaktigt skulle filtrera bort som
    # "saknas". EventItemId krävs för att över huvud taget kunna koppla
    # tillbaka till Legistar (röster, matter-länkning) -- se
    # ai_pipeline/meeting_decisions_legistar.py.
    if item.get("EventItemId") is not None:
        cleaned["EventItemId"] = item["EventItemId"]
    cleaned["EventItemPassedFlagName"] = item.get("EventItemPassedFlagName")
    cleaned["EventItemConsent"] = bool(item.get("EventItemConsent"))
    cleaned["EventItemMatterId"] = item.get("EventItemMatterId")

    # Röster, om hämtade (se LegistarParser.fetch()) -- bara de fält
    # sidan faktiskt visar. VoteEventItemId behålls verbatim: det är så en
    # konsentagenda-underpunkts delade blockröst upptäcks (se
    # ai_pipeline/meeting_decisions_legistar.py, verifierat live mot
    # cityofbrookings 2026-10-14 -- en underpunkts /votes-svar pekar på
    # blockets egna EventItemId, inte punktens egen).
    votes = item.get("_votes")
    if votes:
        cleaned["votes"] = [
            {
                "person": v.get("VotePersonName"),
                "value": v.get("VoteValueName"),
                "vote_event_item_id": v.get("VoteEventItemId"),
            }
            for v in votes
        ]
    return cleaned


def _items_to_text(items: list[dict]) -> str:
    """Platta ut dagordningen till läsbar text för AI-lagret.

    Rent procedurella punkter (upprop, ajournering) blir korta av sig själva, så
    ett möte som BARA innehåller sådant faller naturligt under substansspärren i
    publish.py utan att vi behöver underhålla en skiplista.
    """
    lines: list[str] = []
    for item in items:
        number = (item.get("EventItemAgendaNumber") or "").strip()
        title = (item.get("EventItemTitle") or "").strip()
        matter = (item.get("EventItemMatterName") or "").strip()
        mtype = (item.get("EventItemMatterType") or "").strip()
        action = (item.get("EventItemActionText") or "").strip()
        note = (item.get("EventItemAgendaNote") or "").strip()

        text = title or matter
        if not text:
            continue
        parts = [f"{number}." if number else "", text]
        if matter and matter != title:
            parts.append(f"({matter})")
        if mtype:
            parts.append(f"[{mtype}]")
        if action:
            parts.append(f"-- {action}")
        if note:
            parts.append(f"Note: {note}")
        lines.append(" ".join(p for p in parts if p).strip())
    return "\n".join(lines)
