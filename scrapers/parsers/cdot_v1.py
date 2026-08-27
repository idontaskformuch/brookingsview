"""Trafikincidenter -- Broomfield (CDOT/COtrip).

BROOMFIELD -- CDOT COTRIP (verifierat 2026-08-27, live med riktig nyckel):
Till skillnad från Caltrans QuickMap (traffic_v1.py, helt öppen/nyckelfri)
kräver CDOT:s data.cotrip.org en kostnadsfri men NYCKELBASERAD åtkomst
(CDOT_API_KEY, skickas som query-param ?apiKey=...). configs/broomfield_co.json's
traffic._notes dokumenterade det redan 2026-08-26; nyckeln testades direkt
mot källan innan den här parsern skrevs (samma "verifiera, gissa inte"
-princip som traffic_v1.py):
  - https://data.cotrip.org/api/v1/incidents?apiKey=...       200 OK,
    GeoJSON FeatureCollection, delstatstäckande, ~17 aktiva poster vid
    testtillfället (olyckor, vägarbete, avstängningar -- allt i EN feed,
    till skillnad från Caltrans två separata KML-filer).
  - https://data.cotrip.org/api/v1/roadConditions?apiKey=...  finns också
    men är en HELT ANNAN datamodell (100 vägsegment/sida, ~3.6 MB,
    väderprognoser per segment via ett `currentConditions`-fält) --
    MEDVETET INTE inkluderad i v1: fel granularitet för
    traffic_incidents-tabellen (segment+prognos, inte punktincidenter)
    och mest relevant för bergspass, inte Broomfields Front Range-läge.

Skillnader mot Caltrans-parsern värda att notera:
  - CDOT ger redan ett stabilt eget id (`id`, t.ex.
    "OpenTMS-Incident34824741717") -- ingen regex-extraktion ur fritext
    krävs (jfr _CLOSURE_ID_RE/_CHP_ID_RE i traffic_v1.py).
  - `startTime` är redan ISO8601 UTC ("...Z") -- ingen lokal-tid-
    konvertering behövs (jfr traffic_v1.py:_PACIFIC-kommentaren).
  - `endMarker` är bara ett miltal (spatial, inte temporal). CDOT ger
    DÄREMOT ett riktigt `clearTime`-fält när en incident faktiskt är
    avslutad (upptäckt i liveverifiering: en "event cleared"-post hade
    clearTime satt, aktiva "confirmed report"-poster saknade fältet helt)
    -- ett tydligare signal än något Caltrans/CHP någonsin gav (som aldrig
    har en egen sluttid för CHP-incidenter). Används direkt som ends_at
    när det finns; annars None, samma "NULL när okänt"-mönster som
    traffic_v1.py (widgeten faller tillbaka på last_seen_at, se
    migration 011). Utan detta hade en just avslutad incident kunnat visas
    som "aktiv" i upp till maxAgeHours (3h) på ren last_seen_at-baserad
    utfasning.
  - `injuries`/`fatalities` är riktiga strukturerade fält, inte nyckelord
    att leta efter i fritext -- används direkt i _classify_severity i
    stället för regex mot beskrivningen (mer tillförlitligt än Caltrans-
    varianten där CHP aldrig ger en egen allvarlighetsgrad).
  - Geometri är Point ELLER MultiPoint (start+slutpunkt för en sträcka)
    snarare än Caltrans genomgående enkla Point -- bbox-testet godkänner
    posten om NÅGON av punkterna ligger i boundingboxen, annars hade en
    sträcka som bara delvis går in i Broomfield-området tystats bort.

DEDUP/UPPDATERING: samma resonemang som traffic_v1.py -- en incident kan
uppdateras (nytt status, ändrade impacts) för SAMMA post, så
conflict_columns/update_columns styr db.upsert_records() mot
ON CONFLICT (town_id, external_incident_id) DO UPDATE.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# Regelbaserad klassificering, samma stil/begränsning som traffic_v1.py:
# CDOT ger ingen färdig "closure vs. planned"-tagg, bara fritext + typ.
_CLOSURE_KEYWORDS = ("CLOSED", "CLOSURE", "FULL CLOSURE")
_PLANNED_KEYWORDS = ("SCHEDULED", "PLANNED", "UPCOMING")
_CLOSURE_TYPES = ("CLOSURE", "MAINTENANCE", "ROADWORK", "CONSTRUCTION")


class CdotParser(BaseParser):
    table = "traffic_incidents"
    platform = "traffic"
    conflict_columns = ("town_id", "external_incident_id")
    update_columns = ["description", "road", "severity", "ends_at", "last_seen_at", "raw_data", "content_hash"]

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def _url(self) -> str:
        # Nyckeln lever ENDAST i miljövariabeln (.env / GitHub secret) --
        # aldrig i configs/*.json, som committas till git.
        base = self.source_cfg["url"]
        api_key = os.environ["CDOT_API_KEY"]
        return f"{base}?apiKey={api_key}"

    def fetch(self) -> FetchResult:
        r = requests.get(self._url(), headers=self._headers(), timeout=30)
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="application/geo+json",
                            url=self.source_cfg["url"], http_code=r.status_code)

    def _bbox(self) -> tuple[float, float, float, float]:
        """(min_lat, max_lat, min_lon, max_lon) -- samma resonemang och
        samma marginal som traffic_v1.py:_bbox: feeden är delstatstäckande,
        det här är den enda filtreringen mellan "hela Colorado" och
        "relevant för Broomfield"."""
        bbox = self.source_cfg.get("bbox")
        if bbox:
            return tuple(bbox)
        lat, lon = self.cfg["coordinates"]["lat"], self.cfg["coordinates"]["lon"]
        return (lat - 0.15, lat + 0.15, lon - 0.20, lon + 0.20)

    def _within_bbox(self, lat: float, lon: float) -> bool:
        min_lat, max_lat, min_lon, max_lon = self._bbox()
        return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon

    def _anchor_in_bbox(self, geometry: dict) -> tuple[float, float] | None:
        """Första punkten (lat, lon) som ligger inom boundingboxen, annars
        None. GeoJSON-koordinater är [lon, lat] -- omvänd ordning mot vår
        egen lat/lon-lagring."""
        gtype = geometry.get("type")
        coords = geometry.get("coordinates", [])
        points = coords if gtype == "MultiPoint" else [coords] if gtype == "Point" else []
        for point in points:
            if len(point) < 2:
                continue
            lon, lat = point[0], point[1]
            if self._within_bbox(lat, lon):
                return (lat, lon)
        return None

    def parse(self, fetched: FetchResult) -> list[dict]:
        data = json.loads(fetched.raw)
        rows: list[dict] = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})

            external_id = props.get("id")
            if not external_id:
                # inget stabilt id att dedupa mot -- hoppa hellre över än
                # riskera en duplicerad rad varje körning (samma princip
                # som traffic_v1.py).
                continue

            anchor = self._anchor_in_bbox(feature.get("geometry", {}))
            if anchor is None:
                continue
            lat, lon = anchor

            kind = props.get("type") or ""
            route = props.get("routeName")
            title = f"{kind} on {route}" if kind and route else kind or route or ""
            if not title:
                continue
            description = props.get("travelerInformationMessage")

            rows.append({
                "incident_type": "lane_closure" if _is_closure_type(kind) else "cdot_incident",
                "title": title,
                "description": description,
                "road": route,
                "severity": _classify_severity(props),
                "lat": lat,
                "lon": lon,
                "starts_at": _parse_iso(props.get("startTime")),
                "ends_at": _parse_iso(props.get("clearTime")),
                # last_seen_at = NÄR VI SKRAPADE, inte källans `lastUpdated`
                # -- samma "fortfarande syns i det LIVE flödet"-semantik
                # som traffic_v1.py.
                "last_seen_at": datetime.now(timezone.utc),
                "source": "cdot_cotrip",
                "external_incident_id": external_id,
                "raw_data": props,
                "content_hash": content_hash("traffic", external_id, title, description,
                                              props.get("lastUpdated")),
            })
        return rows


def _is_closure_type(kind: str) -> bool:
    upper = kind.upper()
    return any(k in upper for k in _CLOSURE_TYPES)


def _classify_severity(props: dict) -> str:
    # injuries/fatalities är riktiga räknade fält från CDOT, inte
    # nyckelord i fritext -- kolla dem FÖRE textmatchning.
    if (props.get("fatalities") or 0) > 0 or (props.get("injuries") or 0) > 0:
        return "injury"
    text = f"{props.get('type', '')} {props.get('travelerInformationMessage', '')}".upper()
    if any(k in text for k in _CLOSURE_KEYWORDS):
        return "closure"
    if any(k in text for k in _PLANNED_KEYWORDS):
        return "planned"
    return "incident"


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
