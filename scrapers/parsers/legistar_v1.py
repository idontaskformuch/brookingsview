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

import json
import time
from datetime import datetime, timedelta

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

WEBAPI = "https://webapi.legistar.com/v1"

# hur många möten vi hämtar dagordning för per körning. Varje möte = ett extra
# HTTP-anrop, så vi håller det artigt mot Granicus servrar.
MAX_AGENDA_FETCHES = 40
FETCH_DELAY_SECONDS = 0.25

MAX_AGENDA_TEXT_CHARS = 20_000


class LegistarParser(BaseParser):
    table = "meetings"
    platform = "legistar"

    def _client(self) -> str:
        client = self.source_cfg.get("client_id")
        if not client:
            raise ValueError("legistar client_id saknas i config (verifiera i Stage 0)")
        return client

    def _headers(self) -> dict:
        return {
            "Accept": "application/json",
            "User-Agent": "brookingsview.com (contact: hello@brookingsview.com)",
        }

    def fetch(self) -> FetchResult:
        client = self._client()
        since = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00")
        params = {
            "$filter": f"EventDate ge datetime'{since}'",
            "$orderby": "EventDate desc",
            "$top": "50",
        }
        url = f"{WEBAPI}/{client}/events"
        r = requests.get(url, params=params, timeout=30, headers=self._headers())
        r.raise_for_status()
        events = r.json()

        # hämta dagordningspunkter per möte -- det är där det faktiska innehållet finns
        for event in events[:MAX_AGENDA_FETCHES]:
            event_id = event.get("EventId")
            if not event_id:
                continue
            try:
                items_url = f"{WEBAPI}/{client}/events/{event_id}/eventitems"
                ir = requests.get(items_url, params={"AgendaNote": "1"},
                                  timeout=30, headers=self._headers())
                if ir.status_code == 200:
                    event["_agenda_items"] = ir.json()
            except Exception as exc:  # noqa: BLE001 -- en trasig agenda ska inte fälla mötet
                print(f"    [legistar] kunde inte hämta agenda för event {event_id}: {exc}")
            time.sleep(FETCH_DELAY_SECONDS)

        self._events = events
        raw = json.dumps(events, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json",
                           url=r.url, http_code=r.status_code)

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
    return {k: item.get(k) for k in keep if item.get(k)}


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
