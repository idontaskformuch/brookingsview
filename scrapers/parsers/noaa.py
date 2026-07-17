"""NOAA / National Weather Service väder.

Dokumenterat, nyckelfritt API (api.weather.gov). Flöde:
  1. GET /points/{lat},{lon}  -> ger forecast-URL för rätt grid
  2. GET <forecast-URL>       -> perioder (dag/natt) med temp och beskrivning

VIKTIGT: api.weather.gov KRÄVER en User-Agent-header, annars 403. Sätt USER_AGENT
i env (t.ex. "brookingsview.com (hello@brookingsview.com)").
"""
from __future__ import annotations

import json
import os
from datetime import date

import requests

from scrapers.base_parser import BaseParser, FetchResult

API = "https://api.weather.gov"


class NoaaParser(BaseParser):
    table = "weather_snapshots"
    platform = "noaa"

    def _headers(self) -> dict:
        ua = os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)")
        return {"User-Agent": ua, "Accept": "application/geo+json"}

    def fetch(self) -> FetchResult:
        lat = self.source_cfg.get("lat") or self.cfg["coordinates"]["lat"]
        lon = self.source_cfg.get("lon") or self.cfg["coordinates"]["lon"]
        pts = requests.get(f"{API}/points/{lat},{lon}", headers=self._headers(), timeout=20)
        pts.raise_for_status()
        forecast_url = pts.json()["properties"]["forecast"]
        fc = requests.get(forecast_url, headers=self._headers(), timeout=20)
        fc.raise_for_status()
        return FetchResult(raw=fc.content, content_type="application/geo+json",
                           url=forecast_url, http_code=fc.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        data = json.loads(fetched.raw.decode("utf-8"))
        periods = data.get("properties", {}).get("periods", [])
        # normalisera till en payload per dag (nästa ~7 perioder räcker)
        normalized = [
            {
                "name": p.get("name"),
                "start": p.get("startTime"),
                "temp": p.get("temperature"),
                "unit": p.get("temperatureUnit"),
                "short": p.get("shortForecast"),
                "wind": p.get("windSpeed"),
                "is_daytime": p.get("isDaytime"),
            }
            for p in periods[:14]
        ]
        return [{
            "observed_for": date.today(),
            "payload": {"periods": normalized},
        }]
