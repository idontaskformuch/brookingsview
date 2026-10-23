"""Met Office National Severe Weather Warning Service (NSWWS) via DataHub v1.1.

Verified 2026-10-23 with MET_OFFICE_WARNINGS_API_KEY (header "apikey"):
    GET /nswws/v1.1/objects/feed            -> Atom (application/xml)
        <link rel="related"> = ".../objects/issued/<uuid>/"  -- the latest version
            of ALL currently issued warnings (GeoJSON FeatureCollection)
        <entry><link rel="alternate" .../objects/updated/<uuid>/> -- one update
            object per change (GeoJSON): new warnings and state changes
            ISSUED -> EXPIRED / CANCELLED. Entries only live for 24 h.
Every feature is a MultiPolygon with warningId, warningVersion, warningStatus,
warningLevel (YELLOW/AMBER/RED), weatherType, warningHeadline, whatToExpect,
whatShouldIDo, validFromDate, validToDate, modifiedDate, affectedAreas.

Per the DataHub documentation the links in the feed are followed as given
(rel="related" / rel="alternate"); no URL is built here. Because updates are
only kept for 24 h the feed has to be polled regularly and the warning's state
is stored by us: one events row per warningId (source 'met_office_warning',
identity raw_data.warning_id), overwritten in place when a newer version or an
EXPIRED/CANCELLED state arrives. A row whose warning disappears without us ever
seeing the state change simply keeps status ISSUED and stops being shown when
its valid-to time passes (the site API and the browser both check it).

A warning is stored ONLY when the town's point (config "coordinates") lies
inside its polygon -- a region name in affectedAreas is not enough (verified
2026-10-23: a yellow rain warning listing Strathclyde did not contain the
Glasgow point). Terminal states (EXPIRED/CANCELLED) use the same test.

Terms (weather.metoffice.gov.uk/guides/rss, DataHub licence): the page shows
"Source: Met Office" with a link to the Met Office warnings page.
"""
from __future__ import annotations

import ast
import json
import os
import time
import xml.etree.ElementTree as ET

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

FEED_URL = "https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/feed"
PUBLIC_WARNINGS_URL = "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings"
SOURCE = "met_office_warning"
ATOM = {"a": "http://www.w3.org/2005/Atom"}
MAX_UPDATE_FETCHES = 100
REQUEST_DELAY_SECONDS = 0.2
TERMINAL = {"EXPIRED", "CANCELLED"}


# --- geometry --------------------------------------------------------------

def _in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(lon: float, lat: float, geometry: dict | None) -> bool:
    """GeoJSON (lon, lat) order. Polygon and MultiPolygon, holes respected."""
    if not geometry:
        return False
    kind = geometry.get("type")
    if kind == "Polygon":
        polygons = [geometry.get("coordinates") or []]
    elif kind == "MultiPolygon":
        polygons = geometry.get("coordinates") or []
    else:
        return False
    for poly in polygons:
        if not poly:
            continue
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, hole) for hole in poly[1:]):
            return True
    return False


# --- feed ------------------------------------------------------------------

def parse_feed(xml_bytes: bytes) -> tuple[str | None, list[dict]]:
    """-> (related issued-snapshot URL, entries oldest first: {updated, href})."""
    root = ET.fromstring(xml_bytes)
    related = None
    for link in root.findall("a:link", ATOM):
        if link.get("rel") == "related":
            related = link.get("href")
    entries = []
    for entry in root.findall("a:entry", ATOM):
        href = next((l.get("href") for l in entry.findall("a:link", ATOM) if l.get("rel") == "alternate"), None)
        updated = (entry.findtext("a:updated", default="", namespaces=ATOM) or "")
        if href:
            entries.append({"updated": updated, "href": href})
    entries.sort(key=lambda e: e["updated"])
    return related, entries


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    text = str(value).strip()
    if text.startswith("["):
        try:
            parsed = ast.literal_eval(text)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except (ValueError, SyntaxError):
            pass
    return [text] if text else []


def _version(props: dict) -> float:
    try:
        return float(props.get("warningVersion"))
    except (TypeError, ValueError):
        return 0.0


def newest_per_warning(features: list[dict]) -> dict[str, dict]:
    """Keep the newest state of each warningId: latest modifiedDate, then version."""
    best: dict[str, dict] = {}
    for feat in features:
        p = feat.get("properties") or {}
        wid = p.get("warningId")
        if not wid:
            continue
        key = (p.get("modifiedDate") or "", _version(p))
        cur = best.get(wid)
        if cur is None or key >= (cur["properties"].get("modifiedDate") or "", _version(cur["properties"])):
            best[wid] = feat
    return best


def to_record(feat: dict) -> dict:
    p = feat["properties"]
    regions = []
    areas = p.get("affectedAreas")
    if isinstance(areas, str):
        try:
            areas = ast.literal_eval(areas)
        except (ValueError, SyntaxError):
            areas = []
    for a in areas or []:
        if isinstance(a, dict) and a.get("regionName"):
            regions.append(a["regionName"])
    level = (p.get("warningLevel") or "").lower()
    return {
        "title": p.get("warningHeadline"),
        "starts_at": p.get("validFromDate"),
        "ends_at": p.get("validToDate"),
        "venue": None,
        "source": SOURCE,
        "url": PUBLIC_WARNINGS_URL,
        "raw_data": {
            "warning_id": p["warningId"],
            "version": p.get("warningVersion"),
            "status": (p.get("warningStatus") or "").upper(),
            "level": level,
            "weather_types": _as_list(p.get("weatherType")),
            "likelihood": p.get("warningLikelihood"),
            "impact": p.get("warningImpact"),
            "headline": p.get("warningHeadline"),
            "what_to_expect": _as_list(p.get("whatToExpect")),
            "what_should_i_do": p.get("whatShouldIDo"),
            "further_details": p.get("warningFurtherDetails"),
            "update_description": p.get("warningUpdateDescription"),
            "issued": p.get("issuedDate"),
            "modified": p.get("modifiedDate"),
            "regions": regions,
        },
        "content_hash": content_hash(SOURCE, p["warningId"]),
    }


class MetOfficeWarningsParser(BaseParser):
    table = "events"
    platform = "met_office_nswws"
    # One row per warningId, overwritten in place by newer versions/states.
    identity_key = "warning_id"
    update_columns = ["title", "starts_at", "ends_at", "venue", "url", "raw_data"]

    def _headers(self) -> dict:
        key = os.environ.get("MET_OFFICE_WARNINGS_API_KEY")
        if not key:
            raise RuntimeError("MET_OFFICE_WARNINGS_API_KEY saknas i miljön")
        return {"apikey": key, "User-Agent": user_agent(self.town_id)}

    def _get(self, url: str) -> requests.Response:
        r = requests.get(url, headers=self._headers(), timeout=30)
        r.raise_for_status()
        return r

    def _point(self) -> tuple[float, float]:
        c = self.cfg.get("coordinates") or {}
        if "lat" not in c or "lon" not in c:
            raise ValueError("coordinates {lat, lon} saknas i town-configen")
        return float(c["lon"]), float(c["lat"])

    def fetch(self) -> FetchResult:
        lon, lat = self._point()
        feed = self._get(FEED_URL)
        related, entries = parse_feed(feed.content)
        features: list[dict] = []
        attempted = failed = 0
        last_error = None
        sources = ([related] if related else []) + [e["href"] for e in entries[-MAX_UPDATE_FETCHES:]]
        for i, href in enumerate(sources):
            attempted += 1
            try:
                data = self._get(href).json()
            except (requests.RequestException, ValueError) as exc:
                failed += 1
                last_error = f"{href}: {exc}"
                continue
            for feat in data.get("features", []):
                # Only the warnings that cover the town's point are kept (and
                # stored); the polygon is dropped from the snapshot.
                if point_in_geometry(lon, lat, feat.get("geometry")):
                    features.append({"properties": feat.get("properties") or {}})
            if i + 1 < len(sources):
                time.sleep(REQUEST_DELAY_SECONDS)
        if related and attempted and failed == attempted:
            raise RuntimeError(f"alla NSWWS-hämtningar misslyckades: {last_error}")
        raw = json.dumps({"features": features}, ensure_ascii=False).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=feed.url,
                           http_code=feed.status_code, docs_attempted=attempted,
                           docs_failed=failed, docs_last_error=last_error)

    def parse(self, fetched: FetchResult) -> list[dict]:
        features = json.loads(fetched.raw.decode("utf-8")).get("features", [])
        return [to_record(f) for f in newest_per_warning(features).values()]
