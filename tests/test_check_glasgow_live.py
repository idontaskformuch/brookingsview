from datetime import datetime, timezone
from pathlib import Path

from scripts.check_glasgow_live import check_events, check_weather

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)


FIXTURE = Path(__file__).parent / "fixtures" / "glasgow_weather_ui_2026-11-11.html"
WED = datetime(2026, 11, 11, 17, 10, tzinfo=timezone.utc)


def _weather(names, unit="C"):
    li = "".join(
        f'<li class="ui-wd"><span class="ui-wd__name">{n}</span><div class="ui-range">'
        f'<span class="ui-range__lo">6\u00b0</span><span class="ui-range__hi">11\u00b0</span></div></li>'
        for n in names
    )
    return f'<p class="ui-hero__value"><span>9\u00b0</span><span class="ui-hero__unit">{unit}</span></p><ol class="ui-weekdays">{li}</ol>'


def test_weather_live_page_2026_11_11_passes():
    # 2026-11-11: every glasgow-scrape run that deployed since 3cf39ba (2026-11-05) failed here; the check still read the
    # old forecast__name/forecast__temp markup and found no rows on the redesigned page.
    assert check_weather(FIXTURE.read_text(encoding="utf-8"), now=WED) == []


def test_weather_ok_today_and_tomorrow_in_celsius():
    assert check_weather(_weather(["Today", "Thu", "Fri"]), now=WED) == []


def test_weather_stale_snapshot_without_today_or_tomorrow_fails():
    problems = check_weather(_weather(["Mon", "Tue", "Wed"]), now=WED)
    assert any("Today" in p for p in problems) and any("tomorrow" in p for p in problems)


def test_weather_fahrenheit_fails():
    assert any("degF" in p for p in check_weather(_weather(["Today", "Thu"], unit="F"), now=WED))


def test_weather_without_rows_fails():
    assert any("no temperatures" in p for p in check_weather('<span class="ui-hero__unit">C</span>', now=WED))


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
