"""NOAA/NWS adapter: the payload shape the weather page reads, including the optional pop and fetched_at fields.
The same fixture is read by cron-dispatcher/test/weather.test.ts (TS port must give the same payload); regenerate with
`PYTHONPATH=. python scripts/make_weather_parity_fixtures.py`."""
import json
from datetime import datetime, timezone
from pathlib import Path

from scrapers.base_parser import FetchResult
from scrapers.parsers.noaa import NoaaParser

FX = json.loads((Path(__file__).parent.parent / "cron-dispatcher" / "test" / "fixtures" / "nws_parity.json").read_text(encoding="utf-8"))
CFG = {"town_id": "broomfield_co", "timezone": "America/Denver", "coordinates": {"lat": 39.9205, "lon": -105.0866}}


def _parse(forecast, hourly, now=datetime(2026, 11, 5, 20, 30, 12, tzinfo=timezone.utc)):
    parser = NoaaParser(CFG, {})
    parser._now = lambda: now
    raw = json.dumps({"forecast": forecast, "forecastHourly": hourly}).encode()
    return parser.parse(FetchResult(raw=raw))[0]["payload"]


def test_payload_equals_the_shared_fixture():
    assert _parse(FX["forecast"], FX["forecastHourly"]) == FX["expected"]


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
