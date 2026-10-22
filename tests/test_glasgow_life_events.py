"""scrapers/glasgow_life_events.py against real Glasgow Life what's-on cards
(saved 2026-10-22). Pure functions, no network."""
from pathlib import Path

import pytest

from scrapers.event_sources import EVENT_SOURCE_KINDS
from scrapers.glasgow_life_events import parse_date_text, parse_listing, parse_pages

TZ = "Europe/London"
PAGE = (Path(__file__).parent / "fixtures" / "glasgow_life_whats_on.html").read_bytes()


def test_kind_is_registered():
    assert "glasgow_life" in EVENT_SOURCE_KINDS


def test_every_real_card_parses():
    recs = parse_listing("glasgow_life", PAGE, TZ)
    assert len(recs) == 41
    assert all(r["url"].startswith("https://www.glasgowlife.org.uk/event/") for r in recs)
    assert len({r["content_hash"] for r in recs}) == 41
    assert {r["raw_data"]["kind"] for r in recs} == {"single", "range", "recurring"}


def test_single_with_time_is_local_and_bst_aware():
    w = parse_date_text("Saturday 31st Oct 2026 10:00am", TZ)
    assert w["kind"] == "single" and w["starts_at"] == "2026-10-31T10:00:00+00:00"
    w = parse_date_text("Tuesday 27th Oct 2026 2:30pm", TZ)
    assert w["starts_at"].startswith("2026-10-27T14:30:00") and w["ends_at"] is None
    # 25 Oct 2026 is the last Sunday of October = clocks go back; 31 Oct is GMT
    assert parse_date_text("Saturday 31st Oct 2026 10:00am", TZ)["starts_at"].endswith("+00:00")
    assert parse_date_text("Saturday 10th Oct 2026 10:00am", TZ)["starts_at"].endswith("+01:00")


def test_time_range_gives_an_end_time():
    w = parse_date_text("Sunday 1st Nov 2026 7:30pm - 9:00pm", TZ)
    assert w["starts_at"].startswith("2026-11-01T19:30") and w["ends_at"].startswith("2026-11-01T21:00")


def test_date_only_single_has_no_end():
    w = parse_date_text("Saturday 7th Nov 2026", TZ)
    assert w["starts_at"].startswith("2026-11-07T00:00") and w["ends_at"] is None


def test_range_year_given_once_and_end_is_next_midnight():
    w = parse_date_text("Wednesday 4th Feb - Wednesday 23rd Dec 2026", TZ)
    assert w["kind"] == "range"
    assert w["starts_at"].startswith("2026-02-04T00:00") and w["ends_at"].startswith("2026-12-24T00:00")


def test_range_month_given_once():
    w = parse_date_text("Sunday 25th - Friday 30th Oct 2026", TZ)
    assert w["starts_at"].startswith("2026-10-25T00:00") and w["ends_at"].startswith("2026-10-31T00:00")


def test_range_across_new_year_puts_start_in_previous_year():
    w = parse_date_text("Monday 29th Dec - Saturday 3rd Jan 2026", TZ)
    assert w["starts_at"].startswith("2025-12-29") and w["ends_at"].startswith("2026-01-04")


def test_range_with_two_years():
    w = parse_date_text("Thursday 10th Sept 2026 - Friday 10th Sept 2027", TZ)
    assert w["starts_at"].startswith("2026-09-10") and w["ends_at"].startswith("2027-09-11")


def test_recurring_keeps_sentence_and_until():
    w = parse_date_text("Every week on Tuesday from 2nd Jun 2026 until 31st Dec 2026", TZ)
    assert w["kind"] == "recurring" and w["starts_at"].startswith("2026-06-02") and w["until"] == "2026-12-31"
    assert w["recurrence"].startswith("Every week on Tuesday")
    m = parse_date_text("Every month on the 1st Monday from 5th Jan 2026 until 6th Dec 2026", TZ)
    assert m["starts_at"].startswith("2026-01-05") and m["until"] == "2026-12-06"
    open_ended = parse_date_text("Every week on Friday from 7th Aug 2026", TZ)
    assert "until" not in open_ended and open_ended["starts_at"].startswith("2026-08-07")


@pytest.mark.parametrize("text", ["", "Check venue opening times", "Various dates", "Every week on Tuesday",
                                  "Tuesday 31st Feb 2026", "Friday 9th Oct - Monday 5th Oct 2026"])
def test_unparseable_date_text_is_none(text):
    assert parse_date_text(text, TZ) is None


def test_venue_and_category_are_kept_and_duplicates_across_pages_collapse():
    recs = parse_pages("glasgow_life", PAGE + b"\n--GLPAGE--\n" + PAGE, TZ)
    assert len(recs) == 41
    agatha = next(r for r in recs if "agatha-christie" in r["url"])
    assert agatha["venue"] == "Mitchell Library"
    assert agatha["raw_data"]["category"] == "Living Knowledge Network"
    assert agatha["title"].startswith("Agatha Christie")
