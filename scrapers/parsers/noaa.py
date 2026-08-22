"""NOAA / National Weather Service väder.

Dokumenterat, nyckelfritt API (api.weather.gov). Flöde:
  1. GET /points/{lat},{lon}  -> ger forecast-URL:er för rätt grid, BÅDE den
     befintliga dag/natt-prognosen (properties.forecast) och en timprognos
     (properties.forecastHourly) -- samma familj, samma auth, samma
     svarsform (en lista "periods"), skiljer sig bara i upplösning.
  2. GET <forecast-URL>        -> perioder (dag/natt) med temp och beskrivning
  3. GET <forecastHourly-URL>  -> en rad per timme (name är alltid "" här,
     till skillnad från dag/natt-prognosen -- frontend etiketterar varje
     timme själv utifrån start, se lib/db.ts/weather.astro)

FAS 2: forecastHourly-anropet är NYTT den här omgången (liveverifierat
2026-08-22 mot samma koordinater som redan används för den befintliga
/forecast-hämtningen -- 200 OK, samma svarsform som /forecast, bara med
tomma "name"-fält per timme). Lagras i SAMMA payload-JSONB som periods
redan gör (ingen ny tabell/migration behövs -- payload är redan flexibel).

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

# NWS timprognosen sträcker sig ~7 dygn framåt -- bara den närmaste dagen är
# relevant för en "kommande timmar"-remsa (se weather.astro).
_MAX_HOURLY_PERIODS = 24


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
        props = pts.json()["properties"]

        fc = requests.get(props["forecast"], headers=self._headers(), timeout=20)
        fc.raise_for_status()
        fc_hourly = requests.get(props["forecastHourly"], headers=self._headers(), timeout=20)
        fc_hourly.raise_for_status()

        combined = {"forecast": fc.json(), "forecastHourly": fc_hourly.json()}
        raw = json.dumps(combined, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json",
                           url=props["forecast"], http_code=fc.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        combined = json.loads(fetched.raw.decode("utf-8"))
        periods = combined.get("forecast", {}).get("properties", {}).get("periods", [])
        hourly_periods = combined.get("forecastHourly", {}).get("properties", {}).get("periods", [])

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
        normalized_hourly = [
            {
                "start": p.get("startTime"),
                "temp": p.get("temperature"),
                "unit": p.get("temperatureUnit"),
                "short": p.get("shortForecast"),
                "wind": p.get("windSpeed"),
                "is_daytime": p.get("isDaytime"),
            }
            for p in hourly_periods[:_MAX_HOURLY_PERIODS]
        ]
        return [{
            "observed_for": date.today(),
            "payload": {"periods": normalized, "hourly": normalized_hourly},
        }]
