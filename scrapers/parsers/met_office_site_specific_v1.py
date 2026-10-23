"""Met Office DataHub "Site Specific" forecast (Global Spot, free tier) for a town's point.

Verified 2026-10-23 with MET_OFFICE_API_KEY (header "apikey"):
    GET https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly?latitude=..&longitude=..
    GET https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/daily?latitude=..&longitude=..
Both answer 200 application/json, a GeoJSON FeatureCollection whose one feature carries
properties.modelRunDate and properties.timeSeries (hourly: 49 hourly points from the current hour;
daily: 8 days starting the day before). SI units: temperature degC, wind m/s, direction degrees.

Output is the SAME normalised payload scrapers/parsers/noaa.py writes to weather_snapshots, so the
weather page, the sign strip and the home page need no new data path:
    {"periods": [{name, start, temp, unit, short, wind, is_daytime}, ...],   # day/night periods
     "hourly":  [{start, temp, unit, short, wind, is_daytime}, ...],        # next 24 hours
     "issued":  modelRunDate, "source": "Met Office"}
Differences from NWS: unit is "C" (the site prints payload.unit), wind is "N mph DIR" (UK speeds are
in mph), and `short` is the Met Office significant-weather text. One row per local day
(weather_snapshots is UNIQUE (town_id, observed_for)); update_columns refreshes the payload when the
scraper runs again the same day (noaa.py leaves the first snapshot of the day in place).

Day/night split: periods are 06:00-18:00 local (day, dayMaxScreenTemperature) and 18:00-06:00 local
(night, nightMinScreenTemperature), the same shape NWS uses. is_daytime for hourly points comes from
the sun's elevation at the town's point, not from the weather code.
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

API = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point"
MAX_HOURLY = 24
MAX_PERIODS = 14
MS_TO_MPH = 2.2369363

# Met Office significant weather codes (the same table DataPoint used; 4 and 31+ are not in use).
WEATHER_TEXT = {
    0: "Clear", 1: "Sunny", 2: "Partly cloudy", 3: "Partly cloudy", 5: "Mist", 6: "Fog", 7: "Cloudy",
    8: "Overcast", 9: "Light rain showers", 10: "Light rain showers", 11: "Drizzle", 12: "Light rain",
    13: "Heavy rain showers", 14: "Heavy rain showers", 15: "Heavy rain", 16: "Sleet showers",
    17: "Sleet showers", 18: "Sleet", 19: "Hail showers", 20: "Hail showers", 21: "Hail",
    22: "Light snow showers", 23: "Light snow showers", 24: "Light snow", 25: "Heavy snow showers",
    26: "Heavy snow showers", 27: "Heavy snow", 28: "Thunder showers", 29: "Thunder showers", 30: "Thunder",
}
_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def weather_text(code) -> str:
    try:
        return WEATHER_TEXT.get(int(code), "—")
    except (TypeError, ValueError):
        return "—"


def compass(degrees) -> str:
    try:
        return _COMPASS[int(round(float(degrees) / 22.5)) % 16]
    except (TypeError, ValueError):
        return ""


def wind_text(speed_ms, from_degrees) -> str:
    """Met Office winds are m/s; UK readers expect mph. "12 mph SW" (direction the wind blows FROM)."""
    try:
        mph = int(round(float(speed_ms) * MS_TO_MPH))
    except (TypeError, ValueError):
        return ""
    direction = compass(from_degrees)
    return f"{mph} mph {direction}".strip()


def sun_altitude_deg(when: datetime, lat: float, lon: float) -> float:
    """Approximate solar elevation (degrees) at a UTC instant; good to about a degree, which is plenty
    for a day/night flag."""
    d = (when.astimezone(timezone.utc) - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds() / 86400
    mean_lon = (280.460 + 0.9856474 * d) % 360
    g = math.radians((357.528 + 0.9856003 * d) % 360)
    lam = math.radians(mean_lon + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * d)
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst_hours = (18.697374558 + 24.06570982441908 * d) % 24
    hour_angle = math.radians((gmst_hours * 15 + lon) % 360) - ra
    phi = math.radians(lat)
    alt = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(hour_angle))
    return math.degrees(alt)


def is_daytime(when: datetime, lat: float, lon: float) -> bool:
    return sun_altitude_deg(when, lat, lon) > -0.833  # sunrise/sunset convention


def _parse_time(text: str) -> datetime:
    """Met Office times look like "2026-10-23T17:00Z"."""
    return datetime.strptime(text, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _temp(value):
    return None if value is None else int(round(float(value)))


def _series(doc: dict) -> tuple[list[dict], str | None]:
    feature = (doc.get("features") or [{}])[0]
    props = feature.get("properties") or {}
    return props.get("timeSeries") or [], props.get("modelRunDate")


def build_payload(hourly_doc: dict, daily_doc: dict, now: datetime, lat: float, lon: float, tz: ZoneInfo) -> dict:
    hourly_series, run_h = _series(hourly_doc)
    daily_series, run_d = _series(daily_doc)

    hour_floor = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    hourly = []
    for pt in hourly_series:
        when = _parse_time(pt["time"])
        if when < hour_floor:
            continue
        hourly.append({
            "start": _iso(when),
            "temp": _temp(pt.get("screenTemperature")),
            "unit": "C",
            "short": weather_text(pt.get("significantWeatherCode")),
            "wind": wind_text(pt.get("windSpeed10m"), pt.get("windDirectionFrom10m")),
            "is_daytime": is_daytime(when, lat, lon),
        })
        if len(hourly) == MAX_HOURLY:
            break

    local_now = now.astimezone(tz)
    today = local_now.date()
    periods = []
    for pt in daily_series:
        day_date = _parse_time(pt["time"]).date()
        if day_date < today:
            continue
        day_start = datetime(day_date.year, day_date.month, day_date.day, 6, tzinfo=tz)
        night_start = datetime(day_date.year, day_date.month, day_date.day, 18, tzinfo=tz)
        weekday = day_date.strftime("%A")
        if not (day_date == today and local_now >= night_start):
            periods.append({
                "name": "Today" if day_date == today else weekday,
                "start": _iso(day_start),
                "temp": _temp(pt.get("dayMaxScreenTemperature")),
                "unit": "C",
                "short": weather_text(pt.get("daySignificantWeatherCode")),
                "wind": wind_text(pt.get("midday10MWindSpeed"), pt.get("midday10MWindDirection")),
                "is_daytime": True,
            })
        periods.append({
            "name": "Tonight" if day_date == today else f"{weekday} Night",
            "start": _iso(night_start),
            "temp": _temp(pt.get("nightMinScreenTemperature")),
            "unit": "C",
            "short": weather_text(pt.get("nightSignificantWeatherCode")),
            "wind": wind_text(pt.get("midnight10MWindSpeed"), pt.get("midnight10MWindDirection")),
            "is_daytime": False,
        })
        if len(periods) >= MAX_PERIODS:
            break

    return {"periods": periods[:MAX_PERIODS], "hourly": hourly, "issued": run_h or run_d, "source": "Met Office"}


class MetOfficeSiteSpecificParser(BaseParser):
    table = "weather_snapshots"
    platform = "met_office_datahub"
    update_columns = ["payload"]

    #: tests replace this
    _now = staticmethod(lambda: datetime.now(timezone.utc))

    def _headers(self) -> dict:
        key = os.environ.get("MET_OFFICE_API_KEY")
        if not key:
            raise RuntimeError("MET_OFFICE_API_KEY saknas i miljön")
        return {"apikey": key, "Accept": "application/json", "User-Agent": user_agent(self.town_id)}

    def _point(self) -> tuple[float, float]:
        c = self.cfg.get("coordinates") or {}
        lat = self.source_cfg.get("lat") or c.get("lat")
        lon = self.source_cfg.get("lon") or c.get("lon")
        if lat is None or lon is None:
            raise ValueError("coordinates {lat, lon} saknas i town-configen")
        return float(lat), float(lon)

    def fetch(self) -> FetchResult:
        lat, lon = self._point()
        docs = {}
        last = None
        for kind in ("hourly", "daily"):
            r = requests.get(f"{API}/{kind}", params={"latitude": lat, "longitude": lon},
                             headers=self._headers(), timeout=30)
            r.raise_for_status()
            docs[kind] = r.json()
            last = r
        raw = json.dumps(docs, ensure_ascii=False).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=f"{API}/hourly+daily",
                           http_code=last.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        docs = json.loads(fetched.raw.decode("utf-8"))
        lat, lon = self._point()
        tz = ZoneInfo(self.cfg.get("timezone") or "Europe/London")
        now = self._now()
        payload = build_payload(docs["hourly"], docs["daily"], now, lat, lon, tz)
        if not payload["hourly"] or not payload["periods"]:
            raise ValueError("Met Office svarade utan prognospunkter")
        observed_for: date = now.astimezone(tz).date()
        return [{"observed_for": observed_for, "payload": payload}]
