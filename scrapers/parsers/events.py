"""Lokala evenemang — kombinerar flera oberoende delkällor till "This Week in Brookings".

Varje delkälla i configens events.sources hanteras oberoende av de andra: en trasig
eller ej färdigbyggd delkälla ska aldrig blockera de som fungerar. Delkällor har ett
"kind"-fält som styr hur de hanteras:

  - "ical":        riktig iCal/ICS-feed, hämtas och parsas med `icalendar` (RFC 5545).
                    Fetch/parse-logiken bor i scrapers/event_sources.py (source
                    registry, Fas 3 del 1) -- lägg en NY kind där, inte här, när
                    fler källtyper (WebTrac, m.fl.) läggs till.
  - "blocked":      källan är medvetet AVSTÄNGD av policyskäl (t.ex. robots.txt nekar
                    åtkomst) -- loggas tydligt, körs aldrig, skrapas ALDRIG ändå.
  - "unconfirmed":  strukturen är inte verifierad än (Stage 0 ofullständig) -- loggas
                    och hoppas över tills en riktig feed-URL är bekräftad.

"blocked" och "unconfirmed" är inga riktiga hämtningsbara kinds -- de är inerta
markörer som kollas HÄR, innan registret ens konsulteras (se event_sources.py:s
egen kommentar om detta). En okänd kind (varken registrerad eller en av dessa två
markörer) hoppas också över, samma sätt som idag.

Detta är den viktigaste återbesöks-motorn tillsammans med sdsu_athletics (se PLAN.md).

STATUS 2026-07-17:
  - library (LibCal, brookingslibrary.libcal.com): BEKRÄFTAD, byggd, redo att testas.
  - city_parks_rec: POLICYBLOCKERAD -- cityofbrookings-sd.gov/robots.txt nekar
    automatiserad åtkomst till calendar.aspx. Skrapa aldrig, oavsett User-Agent-trick.
    Rätt väg: be staden om RSS/iCal/API när ni ändå kontaktar dem om SmartGov.
  - sdsu_events: overifierad. Sidans URL (sdstate.edu/events) är sannolikt en
    Localist/Concept3D-kalender med ett eget ICS-exportflöde, men det flödet är inte
    hittat/bekräftat än. Kräver samma researcha-i-browser-steg som library fick.
"""
from __future__ import annotations

import os

from scrapers.base_parser import BaseParser, FetchResult
from scrapers.event_sources import EVENT_SOURCE_KINDS

_INERT_KINDS = {
    "blocked": "policyblockerad (robots.txt) -- skrapas aldrig",
    "unconfirmed": "overifierad källa -- hoppar över (Stage 0 ofullständig)",
}


class EventsParser(BaseParser):
    table = "events"
    platform = "multi_events"

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        sources = self.source_cfg.get("sources", [])
        blobs: dict[str, bytes] = {}

        for src in sources:
            name = src.get("name")
            kind = src.get("kind")

            if kind in _INERT_KINDS:
                print(f"    [events:{name}] {_INERT_KINDS[kind]}")
                continue

            source_kind = EVENT_SOURCE_KINDS.get(kind)
            if source_kind is None:
                print(f"    [events:{name}] okänd kind='{kind}' -- hoppar över")
                continue

            try:
                blob = source_kind.fetch(src, self._headers())
            except Exception as exc:  # noqa: BLE001 — en trasig delkälla ska inte fälla de andra
                print(f"    [events:{name}] fel vid hämtning: {exc}")
                continue
            if blob is None:
                continue
            blobs[name] = blob

        self._blobs = blobs
        # snapshot: alla källors råa svar konkatenerade med tydliga separatorer
        combined = b"\n--EVENTSOURCE--\n".join(
            name.encode() + b"\n" + blob for name, blob in blobs.items()
        )
        return FetchResult(raw=combined, content_type="text/calendar",
                           url="multi:events", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        blobs = getattr(self, "_blobs", None)
        if blobs is None:
            blobs = {}
            for chunk in fetched.raw.split(b"\n--EVENTSOURCE--\n"):
                if not chunk.strip():
                    continue
                name, _, blob = chunk.partition(b"\n")
                blobs[name.decode()] = blob

        sources_by_name = {src.get("name"): src for src in self.source_cfg.get("sources", [])}

        out: list[dict] = []
        for name, blob in blobs.items():
            kind = sources_by_name.get(name, {}).get("kind")
            source_kind = EVENT_SOURCE_KINDS.get(kind)
            if source_kind is None:
                # Kan bara hända om self._blobs saknas (t.ex. återuppspelning
                # från en sparad snapshot i ett annat process) och configen
                # samtidigt har ändrats sedan snapshotten togs -- samma
                # "hoppa över okänt" som fetch() gör.
                print(f"    [events:{name}] okänd/ändrad kind vid parse -- hoppar över")
                continue
            out.extend(source_kind.parse(name, blob))
        return out
