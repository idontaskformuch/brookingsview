"""Lokala evenemang — kombinerar flera oberoende delkällor till "This Week in Brookings".

Varje delkälla i configens events.sources hanteras oberoende av de andra: en trasig
eller ej färdigbyggd delkälla ska aldrig blockera de som fungerar. Delkällor har ett
"kind"-fält som styr hur de hanteras:

  - "ical":        riktig iCal/ICS-feed, hämtas och parsas med `icalendar` (RFC 5545).
  - "blocked":      källan är medvetet AVSTÄNGD av policyskäl (t.ex. robots.txt nekar
                    åtkomst) -- loggas tydligt, körs aldrig, skrapas ALDRIG ändå.
  - "unconfirmed":  strukturen är inte verifierad än (Stage 0 ofullständig) -- loggas
                    och hoppas över tills en riktig feed-URL är bekräftad.

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

from datetime import datetime, timezone

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult


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

            if kind == "blocked":
                print(f"    [events:{name}] policyblockerad (robots.txt) -- skrapas aldrig")
                continue
            if kind == "unconfirmed":
                print(f"    [events:{name}] overifierad källa -- hoppar över (Stage 0 ofullständig)")
                continue
            if kind != "ical":
                print(f"    [events:{name}] okänd kind='{kind}' -- hoppar över")
                continue

            url = src.get("url")
            if not url:
                continue
            try:
                r = requests.get(url, headers=self._headers(), timeout=20)
                r.raise_for_status()
                blobs[name] = r.content
            except Exception as exc:  # noqa: BLE001 — en trasig delkälla ska inte fälla de andra
                print(f"    [events:{name}] fel vid hämtning: {exc}")

        self._blobs = blobs
        # snapshot: alla ICS-flöden konkatenerade med tydliga separatorer
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
                name, _, ics = chunk.partition(b"\n")
                blobs[name.decode()] = ics

        out: list[dict] = []
        for name, ics_bytes in blobs.items():
            out.extend(self._parse_ical(name, ics_bytes))
        return out

    def _parse_ical(self, source_name: str, ics_bytes: bytes) -> list[dict]:
        try:
            from icalendar import Calendar
        except ImportError:
            print("    [events] paketet 'icalendar' saknas -- lägg till i requirements.txt")
            return []

        try:
            cal = Calendar.from_ical(ics_bytes)
        except Exception as exc:  # noqa: BLE001 — trasig ICS ska inte krascha hela körningen
            print(f"    [events:{source_name}] kunde inte tolka ICS: {exc}")
            return []

        records = []
        for component in cal.walk("VEVENT"):
            uid = str(component.get("UID", ""))
            title = str(component.get("SUMMARY", "")).strip()
            if not title:
                continue

            dtstart = component.get("DTSTART")
            dtend = component.get("DTEND")
            starts_at = _to_iso(dtstart.dt) if dtstart else None
            ends_at = _to_iso(dtend.dt) if dtend else None

            location = str(component.get("LOCATION", "")).strip() or None
            description = str(component.get("DESCRIPTION", "")).strip() or None
            url = str(component.get("URL", "")).strip() or None

            records.append({
                "title": title,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "venue": location,
                "source": source_name,
                "url": url,
                "raw_data": {"uid": uid, "description": description},
                "content_hash": content_hash("events", source_name, uid, starts_at, title),
            })
        return records


def _to_iso(dt) -> str | None:
    """icalendar ger antingen date eller datetime; normalisera till ISO-sträng."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    # rent datum (heldagsevent) -> midnatt
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc).isoformat()
