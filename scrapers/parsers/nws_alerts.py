"""NWS aktiva vädervarningar för orten.

Dokumenterat, nyckelfritt: GET api.weather.gov/alerts/active?zone={zone}
OBS (Stage 0, 2026-07-17): api.weather.gov skiljer på query-parametrarna
`area` (delstatskod, t.ex. "SD") och `zone` (specifik zon-/county-kod, t.ex.
"SDC011") — `?area=SDC011` gav 400 Bad Request. Configens fält heter
weather_alerts.area av historiska skäl, men värdet (en zon-/county-kod) MÅSTE
skickas som `zone`-parametern till API:et.
Zone/county-koden (t.ex. SDC011 för Brookings County) MÅSTE verifieras i Stage 0
och sättas i configens weather_alerts.area.

Skriver till events-tabellen som en tidsbegränsad "alert"-post (source='nws_alert'),
så frontend kan visa en lugn, tydlig banner utan eget schema.
"""
from __future__ import annotations

import json
import os

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

API = "https://api.weather.gov/alerts/active"


class NwsAlertsParser(BaseParser):
    table = "events"
    platform = "nws"

    def _headers(self) -> dict:
        ua = os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")
        return {"User-Agent": ua, "Accept": "application/geo+json"}

    def fetch(self) -> FetchResult:
        area = self.source_cfg.get("area")
        if not area:
            raise ValueError("weather_alerts.area (NWS zone-kod) saknas i config — verifiera i Stage 0")
        r = requests.get(API, params={"zone": area}, headers=self._headers(), timeout=20)
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="application/geo+json",
                           url=r.url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        data = json.loads(fetched.raw.decode("utf-8"))
        out = []
        for feat in data.get("features", []):
            p = feat.get("properties", {})
            out.append({
                "title": p.get("event"),
                "starts_at": p.get("onset") or p.get("effective"),
                "ends_at": p.get("ends") or p.get("expires"),
                "venue": p.get("areaDesc"),
                "source": "nws_alert",
                "url": p.get("@id"),
                "raw_data": {
                    "severity": p.get("severity"),
                    "headline": p.get("headline"),
                    "description": p.get("description"),
                    "instruction": p.get("instruction"),
                },
                "content_hash": content_hash("nws", p.get("id") or p.get("@id")),
            })
        return out
