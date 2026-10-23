"""Met Office Site Specific adapter -- real 2026-10-23 hourly + daily responses as fixtures."""
import json
from datetime import datetime, timezone
from pathlib import Path

from scrapers.base_parser import FetchResult
from scrapers.parsers.met_office_site_specific_v1 import (
    MetOfficeSiteSpecificParser,
    compass,
    is_daytime,
    weather_text,
    wind_text,
)

FIX = Path(__file__).parent / "fixtures"
CFG = {"town_id": "glasgow", "timezone": "Europe/London", "coordinates": {"lat": 55.8642, "lon": -4.2518}}
NOW = datetime(2026, 10, 23, 15, 30, tzinfo=timezone.utc)  # 16:30 BST


def _payload(now=NOW):
    docs = {
        "hourly": json.loads((FIX / "met_office_sitespecific_hourly_2026-10-23.json").read_text(encoding="utf-8")),
        "daily": json.loads((FIX / "met_office_sitespecific_daily_2026-10-23.json").read_text(encoding="utf-8")),
    }
    parser = MetOfficeSiteSpecificParser(CFG, {})
    parser._now = lambda: now
    rows = parser.parse(FetchResult(raw=json.dumps(docs).encode()))
    assert len(rows) == 1
    return rows[0]


def test_one_row_per_local_day_in_the_noaa_payload_shape():
    row = _payload()
    assert str(row["observed_for"]) == "2026-10-23"
    p = row["payload"]
    assert set(p) == {"periods", "hourly", "issued", "source"}
    assert p["source"] == "Met Office"
    for h in p["hourly"]:
        assert set(h) == {"start", "temp", "unit", "short", "wind", "is_daytime"}
    for per in p["periods"]:
        assert set(per) == {"name", "start", "temp", "unit", "short", "wind", "is_daytime"}


def test_hourly_is_the_next_24_hours_in_celsius_and_mph():
    h = _payload()["payload"]["hourly"]
    assert len(h) == 24
    assert h[0]["start"] == "2026-10-23T15:00:00Z"
    assert h[2]["start"] == "2026-10-23T17:00:00Z"
    assert h[2]["temp"] == 8 and h[2]["unit"] == "C"          # screenTemperature 7.6
    assert h[2]["short"] == "Cloudy"                            # significantWeatherCode 7
    assert h[2]["wind"] == "9 mph WNW"                          # 3.92 m/s from 294 degrees
    assert [x["start"] for x in h] == sorted(x["start"] for x in h)


def test_day_night_flag_follows_the_sun_not_the_weather_code():
    h = {x["start"]: x["is_daytime"] for x in _payload()["payload"]["hourly"]}
    assert h["2026-10-23T15:00:00Z"] is True     # sunset in Glasgow on 23 Oct is about 16:20 UTC
    assert h["2026-10-23T17:00:00Z"] is False
    assert h["2026-10-24T09:00:00Z"] is True


def test_periods_start_with_today_and_split_day_and_night():
    per = _payload()["payload"]["periods"]
    assert [p["name"] for p in per[:4]] == ["Today", "Tonight", "Saturday", "Saturday Night"]
    assert per[0]["is_daytime"] is True and per[1]["is_daytime"] is False
    sat = per[2]
    assert sat["temp"] == 12 and sat["short"] == "Heavy rain"   # dayMax 12.3, daySignificantWeatherCode 15
    assert sat["unit"] == "C"
    assert per[2]["start"] == "2026-10-24T05:00:00Z"            # 06:00 BST
    assert len(per) <= 14


def test_after_18_local_time_the_day_period_of_today_is_dropped():
    per = _payload(datetime(2026, 10, 23, 17, 30, tzinfo=timezone.utc))["payload"]["periods"]  # 18:30 BST
    assert [p["name"] for p in per[:2]] == ["Tonight", "Saturday"]


def test_clock_change_night_does_not_shift_the_local_label():
    # 2026-10-25 01:00 UTC: UK clocks go back. The Sunday day period still starts at 06:00 local (GMT, 06:00Z).
    per = _payload()["payload"]["periods"]
    sunday = next(p for p in per if p["name"] == "Sunday")
    assert sunday["start"] == "2026-10-25T06:00:00Z"


def test_helpers():
    assert compass(0) == "N" and compass(90) == "E" and compass(294) == "WNW" and compass(359) == "N"
    assert wind_text(10, 225) == "22 mph SW"
    assert weather_text(15) == "Heavy rain" and weather_text(99) == "—" and weather_text(None) == "—"
    assert is_daytime(datetime(2026, 6, 21, 12, tzinfo=timezone.utc), 55.8642, -4.2518) is True
    assert is_daytime(datetime(2026, 6, 21, 22, 30, tzinfo=timezone.utc), 55.8642, -4.2518) is False   # sunset in Glasgow on the solstice is about 20:25 UTC
    assert is_daytime(datetime(2026, 12, 21, 12, tzinfo=timezone.utc), 55.8642, -4.2518) is True
    assert is_daytime(datetime(2026, 12, 21, 17, tzinfo=timezone.utc), 55.8642, -4.2518) is False


def test_empty_answer_is_an_error_not_an_empty_forecast():
    parser = MetOfficeSiteSpecificParser(CFG, {})
    empty = {"features": [{"properties": {"timeSeries": []}}]}
    try:
        parser.parse(FetchResult(raw=json.dumps({"hourly": empty, "daily": empty}).encode()))
    except ValueError:
        return
    raise AssertionError("expected ValueError")
