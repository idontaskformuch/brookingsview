from datetime import datetime, timezone

from scripts.check_glasgow_live import check_events, check_weather

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)


def _weather(rows):
    li = "".join(
        f'<li class="forecast__row"><span class="forecast__name">{n}</span>'
        f'<span class="forecast__temp data">{t}</span></li>'
        for n, t in rows
    )
    return f'<ul class="forecast">{li}</ul>'


def test_weather_ok_today_and_tomorrow_in_celsius():
    html = _weather([("Today", "11\u00b0C"), ("Tonight", "6\u00b0C"), ("Tomorrow", "10\u00b0C")])
    assert check_weather(html) == []


def test_weather_stale_snapshot_without_today_or_tomorrow_fails():
    html = _weather([("Friday", "11\u00b0C"), ("Saturday", "9\u00b0C")])
    problems = check_weather(html)
    assert any("Today" in p for p in problems) and any("Tomorrow" in p for p in problems)


def test_weather_fahrenheit_fails():
    html = _weather([("Today", "50\u00b0F"), ("Tomorrow", "48\u00b0F")])
    assert any("degF" in p for p in check_weather(html))


def _events(box_cards, outside=""):
    cards = "".join(f'<article data-start="{s}" data-end="{e}"></article>' for s, e in box_cards)
    return f'<div class="grid" data-hide-ended>{cards}</div>{outside}'


def test_ended_event_in_live_list_fails():
    html = _events([("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")])
    assert check_events(html, NOW)


def test_upcoming_and_ongoing_events_pass():
    html = _events([("2026-10-25T11:00:00Z", "2026-10-25T14:00:00Z"), ("2026-10-26T18:00:00Z", "")])
    assert check_events(html, NOW) == []


def test_no_end_means_three_hours():
    assert check_events(_events([("2026-10-25T08:00:00Z", "")]), NOW)
    assert check_events(_events([("2026-10-25T10:00:00Z", "")]), NOW) == []


def test_past_events_outside_hide_ended_box_are_ignored():
    outside = '<article data-start="2026-10-01T09:00:00Z" data-end=""></article>'
    assert check_events(_events([], outside), NOW) == []
