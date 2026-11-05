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
import math
import os
import re
from datetime import date, datetime, timezone

import requests

from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

API = "https://api.weather.gov"

# NWS timprognosen sträcker sig ~7 dygn framåt -- bara den närmaste dagen är
# relevant för en "kommande timmar"-remsa (se weather.astro).
_MAX_HOURLY_PERIODS = 24


def _pop(period: dict) -> dict:
    """Chance of precipitation in %: NWS sends {unitCode, value}; the value is null when it has none. Key left out then (cron-dispatcher/src/weather/nws.ts popOf)."""
    value = (period.get("probabilityOfPrecipitation") or {}).get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return {}
    return {"pop": int(round(value))}


def _iso_hours(duration: str):
    """"PT3H" / "P1DT6H" -> hours (whole hours only; anything else is not usable)."""
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?)?", duration or "")
    if not m or (m.group(1) is None and m.group(2) is None):
        return None
    return int(m.group(1) or 0) * 24 + int(m.group(2) or 0)


def _per_hour(series, only_one_hour: bool = False) -> dict:
    """One value per UTC hour (key = epoch seconds of the hour): every hour an interval covers gets the interval's value. only_one_hour keeps
    just the intervals of exactly one hour (an amount over 6 hours cannot be split into hours without guessing)."""
    out = {}
    for v in (series or {}).get("values") or []:
        value = v.get("value")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        start, _, dur = (v.get("validTime") or "").partition("/")
        hours = _iso_hours(dur)
        try:
            t = int(datetime.fromisoformat(start).timestamp())
        except ValueError:
            continue
        if hours is None or hours < 1 or hours > 48 or (only_one_hour and hours != 1):
            continue
        for h in range(hours):
            out[t // 3600 * 3600 + h * 3600] = value
    return out


def merge_gridpoints(hourly: list, grid) -> list:
    """Adds feels (payload unit), gust (mph) and precip_mm (only where the source gives an hour's amount) to the hourly points the gridpoints
    cover; the others stay as they are. Same arithmetic and rounding as mergeGridpoints in cron-dispatcher/src/weather/nws.ts."""
    props = (grid or {}).get("properties")
    if not props:
        return hourly
    feels = _per_hour(props.get("apparentTemperature"))
    gust = _per_hour(props.get("windGust"))
    rain = _per_hour(props.get("quantitativePrecipitation"), True)
    out = []
    for h in hourly:
        try:
            key = int(datetime.fromisoformat(h.get("start") or "").timestamp()) // 3600 * 3600
        except ValueError:
            out.append(h)
            continue
        h = dict(h)
        if key in feels and h.get("unit") in ("F", "C"):
            h["feels"] = int(round(feels[key] * 9 / 5 + 32 if h["unit"] == "F" else feels[key]))
        if key in gust:
            h["gust"] = int(round(gust[key] * 0.621371))
        if key in rain:
            h["precip_mm"] = round(rain[key] * 10) / 10
        out.append(h)
    return out


class NoaaParser(BaseParser):
    table = "weather_snapshots"
    platform = "noaa"

    #: tests replace this
    _now = staticmethod(lambda: datetime.now(timezone.utc))

    def _headers(self) -> dict:
        ua = user_agent(self.town_id)
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
        # Gridpoints (feels like, gusts) are a bonus: any failure leaves the forecast without them. Only the series we use are kept.
        if isinstance(props.get("forecastGridData"), str):
            try:
                grid = requests.get(props["forecastGridData"], headers=self._headers(), timeout=20)
                grid.raise_for_status()
                gp = grid.json().get("properties") or {}
                combined["gridpoints"] = {"properties": {k: gp.get(k) for k in ("apparentTemperature", "windGust", "quantitativePrecipitation")}}
            except (requests.RequestException, ValueError):
                pass
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
                **_pop(p),
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
                **_pop(p),
            }
            for p in hourly_periods[:_MAX_HOURLY_PERIODS]
        ]
        normalized_hourly = merge_gridpoints(normalized_hourly, combined.get("gridpoints"))
        return [{
            "observed_for": date.today(),
            "payload": {"periods": normalized, "hourly": normalized_hourly,
                        "fetched_at": self._now().astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
        }]
