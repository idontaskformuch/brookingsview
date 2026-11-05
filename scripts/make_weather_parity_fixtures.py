"""Regenerate the TS<->Python parity fixtures for the weather payload builders (run from the repo root).

    python -m scripts.make_weather_parity_fixtures

cron-dispatcher/test/fixtures/met_office_parity.json: the input documents are kept; the optional-field inputs (probability of precipitation,
feels-like, gust, UV, precipitation) are injected on a pattern that covers present, missing, zero, half-way (round half to even) and
negative values; `expected` is rebuilt by the PYTHON builder. test/weather.test.ts requires the TS builder to produce exactly that.
cron-dispatcher/test/fixtures/nws_parity.json: the same for scrapers/parsers/noaa.py (forecast + hourly + gridpoints -> payload).
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from scrapers.base_parser import FetchResult
from scrapers.parsers.met_office_site_specific_v1 import build_payload
from scrapers.parsers.noaa import NoaaParser

FIX = Path(__file__).resolve().parent.parent / "cron-dispatcher" / "test" / "fixtures"


def met_office() -> None:
    p = FIX / "met_office_parity.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    hourly = d["hourly"]["features"][0]["properties"]["timeSeries"]
    for i, pt in enumerate(hourly):
        for k in ("probOfPrecipitation", "feelsLikeTemperature", "windGustSpeed10m", "uvIndex", "totalPrecipAmount"):
            pt.pop(k, None)
        if i % 5 == 4:
            continue                                   # a point with none of them
        pt["probOfPrecipitation"] = [0, 12, 50, 49.5, 100][i % 5] if i % 5 < 4 else None
        pt["feelsLikeTemperature"] = [-3.4, 0.5, 7.25, 10.5, -0.6][i % 5]
        pt["windGustSpeed10m"] = [0, 4.5, 8.62, 13.4, 20][i % 5]
        pt["uvIndex"] = [0, 1, 2.5, 3, 0][i % 5]
        pt["totalPrecipAmount"] = [0.0, 0.05, 0.25, 1.35, 2][i % 5]
    daily = d["daily"]["features"][0]["properties"]["timeSeries"]
    for i, pt in enumerate(daily):
        for k in ("dayProbabilityOfPrecipitation", "nightProbabilityOfPrecipitation", "dayMaxFeelsLikeTemp", "nightMinFeelsLikeTemp",
                  "midday10MWindGust", "midnight10MWindGust", "maxUvIndex"):
            pt.pop(k, None)
        if i % 4 == 3:
            continue
        pt.update({"dayProbabilityOfPrecipitation": 20 + i * 10, "nightProbabilityOfPrecipitation": 5 + i * 11, "dayMaxFeelsLikeTemp": 8.5 + i,
                   "nightMinFeelsLikeTemp": -1.5 + i, "midday10MWindGust": 10.3 + i, "midnight10MWindGust": 14.7 - i, "maxUvIndex": i % 4})
    tz = ZoneInfo(d["tz"])
    for c in d["cases"]:
        now = datetime.fromisoformat(c["now"])
        c["expected"] = build_payload(d["hourly"], d["daily"], now, d["lat"], d["lon"], tz)
    p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def nws() -> None:
    """Synthetic but NWS-shaped input: 16 day/night periods and 30 hourly ones, probabilityOfPrecipitation present, null, zero and missing."""
    def pops(i):
        return [{"unitCode": "wmoUnit:percent", "value": 40}, {"unitCode": "wmoUnit:percent", "value": None}, {"unitCode": "wmoUnit:percent", "value": 0},
                None, {"unitCode": "wmoUnit:percent", "value": 62.5}][i % 5]

    def period(i, hourly):
        p = {"number": i + 1, "name": "" if hourly else f"P{i}", "startTime": (f"2026-11-05T{i + 1:02d}:00:00-07:00" if hourly else f"2026-11-0{5 + i // 2}T{6 if i % 2 == 0 else 18}:00:00-07:00"), "temperature": 40 + i,
             "temperatureUnit": "F", "shortForecast": ["Mostly Cloudy", "Chance Rain Showers", "Sunny"][i % 3], "windSpeed": f"{5 + i} mph",
             "isDaytime": i % 2 == 0}
        pop = pops(i)
        if pop is not None:
            p["probabilityOfPrecipitation"] = pop
        return p

    # a real gridpoints answer (Broomfield, 2026-11-05) trimmed to the three series we read; its first value starts 2026-11-05T00:00Z
    grid = json.loads((FIX / "nws_gridpoints_broomfield_2026-11-05.json").read_text(encoding="utf-8"))
    combined = {"forecast": {"properties": {"periods": [period(i, False) for i in range(16)]}},
                "forecastHourly": {"properties": {"periods": [period(i, True) for i in range(30)]}}, "gridpoints": grid}
    parser = NoaaParser({"town_id": "broomfield_co", "timezone": "America/Denver", "coordinates": {"lat": 39.9205, "lon": -105.0866}}, {})
    parser._now = lambda: datetime(2026, 11, 5, 20, 30, 12, tzinfo=timezone.utc)
    payload = parser.parse(FetchResult(raw=json.dumps(combined).encode()))[0]["payload"]
    out = {"now": "2026-11-05T20:30:12Z", **combined, "expected": payload}
    (FIX / "nws_parity.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    met_office()
    nws()
    print("ok")
