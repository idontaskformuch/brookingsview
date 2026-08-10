"""Trafikincidenter/vägavstängningar per ort.

MORENO VALLEY -- CALTRANS QUICKMAP (verifierat 2026-08-10):
quickmap.dot.ca.gov är Caltrans egen, publika trafikkarta. Till skillnad
från vad ett tidigt utkast antog ("IE511/Caltrans kräver en gratis
utvecklarnyckel") visade research att den bakomliggande datan är HELT ÖPPEN,
ingen nyckel, ingen inloggning:
  - https://quickmap.dot.ca.gov/data/lcs2way.kml   (vägarbeten/avstängningar,
    hela delstaten, uppdateras var 5:e minut enligt Caltrans egen
    dokumentation)
  - https://quickmap.dot.ca.gov/data/chp-only.kml  (CHP-incidenter --
    olyckor, faror -- hela delstaten)
200 OK med sajtens vanliga User-Agent, /robots.txt returnerar bara SPA:ns
egen index.html (inget robots.txt deklarerat -- samma "inget uttryckligt
förbud" som MLB Stats API/Thrillshare). Båda filerna är delstatstäckande,
så parsern filtrerar geografiskt till en boundingbox runt orten (se
_within_bbox) -- annars skulle varje körning dra in hundratals incidenter
från hela Kalifornien.

BROOKINGS -- SD511: INGEN öppen källa hittad denna session. SD511.org har
ingen publik developer/API-sida (till skillnad från flera andra staters
511-tjänster som körs på ibi511.com-plattformen, t.ex. 511GA, som HAR en
kontobaserad utvecklarnyckel-portal -- SD511 verkar inte köra på samma
plattform). South Dakota DOT:s egen ArcGIS-tjänst (sdgis.sd.gov) kunde inte
nås från den här miljön (anslutning vägrades/timeout) -- oklart om det är en
tillfällig nätverksbegränsning här eller en riktig blockering på källans
sida. enabled=false i configen tills detta är utrett -- se _notes.

Källorna har helt olika form (KML+CDATA-HTML vs. en framtida SD511-källa),
så dispatchen sker på source_cfg["source"] precis som school_alerts_v1.py.

DEDUP/UPPDATERING: en incident kan legitimt uppdateras (ny loggrad, ändrad
sluttid) för SAMMA post -- samma "mutable record"-resonemang som
regional_sports_v1.py. conflict_columns/update_columns styr
db.upsert_records() mot ON CONFLICT (town_id, external_incident_id) DO
UPDATE i stället för standardbeteendet DO NOTHING.
"""
from __future__ import annotations

import os
import re
import warnings
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
import requests

# Caltrans tidsstämplar (både "Expected to end at" och "Last updated") är
# lokal Kalifornien-tid, INTE UTC -- att bara stämpla siffrorna med
# timezone.utc (upptäckt vid liveverifiering: gav en artificiell ~7-9h
# förskjutning som fick FÄRSKA incidenter att se ut som redan för gamla för
# 3-timmarsfönstret i getActiveTrafficIncidents) skulle tyst räkna om
# klockan fel. DST-medveten korrekt konvertering via zoneinfo i stället.
_PACIFIC = ZoneInfo("America/Los_Angeles")

# Medvetet val (se moduldocstring vid _parse_kml): html.parser i stället för
# lxml/"xml" för att slippa en ny beroende. bs4 varnar annars vid VARJE
# körning om att KML:en "ser ut som XML" -- redan känt och avsiktligt.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# Källans egna sluttidsformat, t.ex. "6:01pm Aug 31, 2026"
_END_TIME_RE = re.compile(
    r"Expected to end at\s+(\d{1,2}:\d{2}[ap]m)\s+(\w+ \d{1,2}, \d{4})", re.IGNORECASE
)
_CLOSURE_ID_RE = re.compile(r"Closure ID:\s*([^,]+),\s*Log Number:\s*(\S+)")
_CHP_ID_RE = re.compile(r"CHP Incident\s+(\S+)")


class TrafficParser(BaseParser):
    table = "traffic_incidents"
    platform = "traffic"
    # Se moduldocstring: en incident uppdateras (loggrad/sluttid) för SAMMA
    # post i stället för att vara oföränderlig källdata som möten/event.
    conflict_columns = ("town_id", "external_incident_id")
    update_columns = ["description", "ends_at", "last_seen_at", "raw_data", "content_hash"]

    def _headers(self) -> dict:
        return {"User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")}

    def fetch(self) -> FetchResult:
        source = self.source_cfg.get("source", "")
        if source == "caltrans_quickmap":
            return self._fetch_caltrans()
        raise ValueError(f"okänd traffic source: {source!r}")

    def _fetch_caltrans(self) -> FetchResult:
        urls = self.source_cfg["urls"]  # {"lane_closures": "...", "chp_incidents": "..."}
        payloads = {}
        for kind, url in urls.items():
            r = requests.get(url, headers=self._headers(), timeout=30)
            r.raise_for_status()
            payloads[kind] = r.text
        self._payloads = payloads
        # sparas som en enda snapshot -- kombinerad text räcker för proveniens
        raw = "\n".join(payloads.values()).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/vnd.google-earth.kml+xml",
                           url=next(iter(urls.values())), http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        source = self.source_cfg.get("source", "")
        if source == "caltrans_quickmap":
            return self._parse_caltrans()
        raise ValueError(f"okänd traffic source: {source!r}")

    def _bbox(self) -> tuple[float, float, float, float]:
        """(min_lat, max_lat, min_lon, max_lon). Boundingbox runt orten --
        Caltrans-feeden är delstatstäckande, så det här är den enda
        filtreringen mellan "hela Kalifornien" och "relevant för orten".
        Generöst tilltagen (~±0.15-0.2 grader, ett par mil) för att fånga
        närliggande motorvägssträckor (SR-60, I-215) som passerar precis
        utanför stadsgränsen men fortfarande är pendlingsrelevanta."""
        bbox = self.source_cfg.get("bbox")
        if bbox:
            return tuple(bbox)
        lat, lon = self.cfg["coordinates"]["lat"], self.cfg["coordinates"]["lon"]
        return (lat - 0.15, lat + 0.15, lon - 0.20, lon + 0.20)

    def _within_bbox(self, lat: float, lon: float) -> bool:
        min_lat, max_lat, min_lon, max_lon = self._bbox()
        return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon

    def _parse_caltrans(self) -> list[dict]:
        rows: list[dict] = []
        payloads = getattr(self, "_payloads", None)
        if payloads is None:
            raise RuntimeError("_parse_caltrans anropad utan föregående fetch() i samma process")

        if "lane_closures" in payloads:
            rows += self._parse_kml(payloads["lane_closures"], "lane_closure")
        if "chp_incidents" in payloads:
            rows += self._parse_kml(payloads["chp_incidents"], "chp_incident")
        return rows

    def _parse_kml(self, kml_text: str, incident_type: str) -> list[dict]:
        # "html.parser" i stället för "xml" (lxml) -- KML:en har ingen
        # namnrymdsanvändning våra selektorer bryr sig om, och html.parser
        # är redan projektets standardparser (se county_alerts.py m.fl.),
        # så ingen ny beroende (lxml) behöver läggas till i requirements.txt.
        soup = BeautifulSoup(kml_text, "html.parser")
        rows = []
        # html.parser normaliserar alla tagg-namn till gemener (verifierat --
        # KML-attributen <Placemark>/<Point> matchar INTE med versal-namn).
        for placemark in soup.find_all("placemark"):
            desc_tag = placemark.find("description")
            point_tag = placemark.find("point")
            # Placemarks utan description är bara linjegeometri för att rita
            # ut en avstängd sträcka på kartan (se t.ex. "C1TA Log 10 path" i
            # moduldocstringens exempel) -- inte en egen incident.
            if not desc_tag or not point_tag:
                continue

            coords_tag = point_tag.find("coordinates")
            if not coords_tag or not coords_tag.text.strip():
                continue
            lon_s, lat_s, *_ = coords_tag.text.strip().split(",")
            lat, lon = float(lat_s), float(lon_s)
            if not self._within_bbox(lat, lon):
                continue

            desc_html = desc_tag.text
            body = BeautifulSoup(desc_html, "html.parser")
            title_el = body.select_one(".iw-title")
            text_els = body.select(".iw-text")
            title = title_el.get_text(" ", strip=True) if title_el else None
            description = " / ".join(t.get_text(" ", strip=True) for t in text_els) if text_els else None
            if not title:
                continue

            if incident_type == "lane_closure":
                m = _CLOSURE_ID_RE.search(desc_html)
                external_id = f"{m.group(1).strip()}-{m.group(2).strip()}" if m else None
            else:
                m = _CHP_ID_RE.search(desc_html)
                external_id = m.group(1).strip() if m else None
            if not external_id:
                # inget stabilt id att dedupa mot -- hoppa hellre över än
                # riskera en duplicerad rad varje körning.
                continue

            ends_at = None
            m = _END_TIME_RE.search(desc_html)
            if m:
                ends_at = _parse_caltrans_dt(f"{m.group(2)} {m.group(1)}", "%b %d, %Y %I:%M%p")

            # last_seen_at = NÄR VI SKRAPADE, inte källans egna "Last
            # updated"-fält. Semantiskt räcker det (frågan är "ser
            # scrapern fortfarande den här incidenten i det LIVE flödet",
            # inte exakt när Caltrans senast internt tidsstämplade posten),
            # och slipper därmed ett andra tillfälle att göra samma
            # tidszonsmiss som ends_at nästan gjorde.
            last_seen_at = datetime.now(timezone.utc)

            rows.append({
                "incident_type": incident_type,
                "title": title,
                "description": description,
                "road": _road_from_title(title),
                "severity": None,
                "lat": lat,
                "lon": lon,
                "starts_at": None,
                "ends_at": ends_at,
                "last_seen_at": last_seen_at,
                "source": "caltrans_quickmap",
                "external_incident_id": external_id,
                "raw_data": {"title": title, "description": description, "lat": lat, "lon": lon},
                "content_hash": content_hash("traffic", external_id, title, description, str(ends_at)),
            })
        return rows


def _road_from_title(title: str) -> str | None:
    m = re.match(r"(Route\s+\d+)", title, re.IGNORECASE)
    return m.group(1) if m else None


def _parse_caltrans_dt(s: str, fmt: str) -> datetime | None:
    try:
        dt = datetime.strptime(s.strip(), fmt)
        # Lokalisera till Pacific INNAN konvertering till UTC -- se
        # _PACIFIC-kommentaren högst upp i filen för bakgrunden (en
        # liveverifiering fångade att bara stämpla siffrorna med
        # timezone.utc rakt av gav en felaktig ~7-9h förskjutning).
        return dt.replace(tzinfo=_PACIFIC).astimezone(timezone.utc)
    except ValueError:
        return None
