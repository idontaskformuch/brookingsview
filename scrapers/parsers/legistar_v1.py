"""Legistar-möten via den dokumenterade WebAPI:n.

Legistar (Granicus) exponerar ett publikt REST-API:
    https://webapi.legistar.com/v1/{client}/events
Detta är stabilare än att skrapa HTML och återanvänds RAKT AV för varje framtida
ort som kör Legistar (mycket vanligt i USA) — bara client_id byts i configen.

STAGE 0: verifiera client_id. Configen gissar "cityofbrookings"; stadssajten är
cityofbrookings-sd.gov, så bekräfta rätt slug mot webapi.legistar.com/v1/<slug>/events.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

WEBAPI = "https://webapi.legistar.com/v1"


class LegistarParser(BaseParser):
    table = "meetings"
    platform = "legistar"

    def _client(self) -> str:
        client = self.source_cfg.get("client_id")
        if not client:
            raise ValueError("legistar client_id saknas i config (verifiera i Stage 0)")
        return client

    def fetch(self) -> FetchResult:
        client = self._client()
        # hämta möten från de senaste 30 dagarna och framåt
        since = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00")
        params = {
            "$filter": f"EventDate ge datetime'{since}'",
            "$orderby": "EventDate desc",
            "$top": "50",
        }
        url = f"{WEBAPI}/{client}/events"
        r = requests.get(url, params=params, timeout=30,
                         headers={"Accept": "application/json"})
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="application/json",
                           url=r.url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        events = json.loads(fetched.raw.decode("utf-8"))
        out = []
        for e in events:
            event_id = e.get("EventId")
            body = e.get("EventBodyName")
            date_str = e.get("EventDate")
            # Legistar levererar ofta agenda/minutes som separata filreferenser
            agenda = e.get("EventAgendaFile")
            minutes = e.get("EventMinutesFile")
            out.append({
                "body": body,
                "meeting_date": date_str,
                "agenda_url": agenda,
                "minutes_url": minutes,
                "raw_data": e,
                "content_hash": content_hash("legistar", event_id, date_str),
            })
        return out
