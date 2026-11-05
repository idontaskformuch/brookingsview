"""NOAA/NWS adapter: the payload shape the weather page reads, including the optional pop and fetched_at fields.
The same fixture is read by cron-dispatcher/test/weather.test.ts (TS port must give the same payload); regenerate with
`PYTHONPATH=. python scripts/make_weather_parity_fixtures.py`."""
import json
from datetime import datetime, timezone
from pathlib import Path

from scrapers.base_parser import FetchResult
from scrapers.parsers.noaa import NoaaParser, merge_gridpoints

FX = json.loads((Path(__file__).parent.parent / "cron-dispatcher" / "test" / "fixtures" / "nws_parity.json").read_text(encoding="utf-8"))
CFG = {"town_id": "broomfield_co", "timezone": "America/Denver", "coordinates": {"lat": 39.9205, "lon": -105.0866}}


def _parse(forecast, hourly, now=datetime(2026, 11, 5, 20, 30, 12, tzinfo=timezone.utc), gridpoints=None):
    parser = NoaaParser(CFG, {})
    parser._now = lambda: now
    combined = {"forecast": forecast, "forecastHourly": hourly}
    if gridpoints is not None:
        combined["gridpoints"] = gridpoints
    raw = json.dumps(combined).encode()
    return parser.parse(FetchResult(raw=raw))[0]["payload"]


def test_payload_equals_the_shared_fixture():
    assert _parse(FX["forecast"], FX["forecastHourly"], gridpoints=FX["gridpoints"]) == FX["expected"]


def test_pop_only_when_the_source_has_a_number():
    p = FX["expected"]
    assert [x.get("pop") for x in p["periods"][:5]] == [40, None, 0, None, 62]      # 62.5 rounds half to even
    assert "pop" not in p["periods"][1] and "pop" not in p["periods"][3]


def test_fetched_at_is_utc_whole_seconds():
    p = _parse(FX["forecast"], FX["forecastHourly"], datetime(2026, 11, 5, 13, 30, 12, 999999, tzinfo=timezone.utc))
    assert p["fetched_at"] == "2026-11-05T13:30:12Z"


def test_an_older_style_answer_without_pop_still_parses():
    plain = {"properties": {"periods": [{"name": "Today", "startTime": "2026-11-05T14:00:00-07:00", "temperature": 50, "temperatureUnit": "F",
                                         "shortForecast": "Sunny", "windSpeed": "5 mph", "isDaytime": True}]}}
    p = _parse(plain, plain)
    assert set(p["periods"][0]) == {"name", "start", "temp", "unit", "short", "wind", "is_daytime"}


HOURLY = [{"start": f"2026-11-05T{h}:00:00-07:00", "temp": 50, "unit": "F", "short": "x", "wind": None, "is_daytime": True} for h in (10, 11, 12)]
GRID = {"properties": {
    "apparentTemperature": {"values": [{"validTime": "2026-11-05T17:00:00+00:00/PT2H", "value": 10}]},      # 17Z and 18Z = 10:00 and 11:00 -07:00
    "windGust": {"values": [{"validTime": "2026-11-05T17:00:00+00:00/PT1H", "value": 32.1869}]},           # 20 mph
    "quantitativePrecipitation": {"values": [{"validTime": "2026-11-05T17:00:00+00:00/PT1H", "value": 0.25},
                                             {"validTime": "2026-11-05T18:00:00+00:00/PT6H", "value": 3}]},
}}


def test_gridpoints_every_hour_of_an_interval_gets_its_value_and_an_uncovered_hour_gets_nothing():
    out = merge_gridpoints(HOURLY, GRID)
    assert out[0]["feels"] == 50 and out[0]["gust"] == 20 and out[0]["precip_mm"] == 0.2     # 10 degC = 50 F; 0.25 rounds half to even
    assert out[1]["feels"] == 50 and "gust" not in out[1]
    assert "feels" not in out[2]


def test_a_six_hour_amount_is_not_split_into_hours_and_celsius_stays_celsius():
    assert "precip_mm" not in merge_gridpoints(HOURLY, GRID)[1]
    assert merge_gridpoints([{**HOURLY[0], "unit": "C"}], GRID)[0]["feels"] == 10


def test_no_gridpoints_or_a_point_without_a_usable_time_changes_nothing():
    assert merge_gridpoints(HOURLY, None) == HOURLY
    assert merge_gridpoints(HOURLY, {"properties": {}}) == HOURLY
    assert merge_gridpoints([{**HOURLY[0], "start": None}], GRID) == [{**HOURLY[0], "start": None}]
