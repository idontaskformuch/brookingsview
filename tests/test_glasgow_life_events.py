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
    recs = parse_pages("glasgow_life", PAGE + b"\n--GLPAGE--\n" + PAGE, TZ, today=date(2026, 10, 23))  # fixed clock: the fixture is a Fri 23 Oct snapshot
    # still 41 distinct events (a recurring one now contributes one record per upcoming date)
    assert len({r['raw_data']['uid'] for r in recs}) == 41
    agatha = next(r for r in recs if "agatha-christie" in r["url"])
    assert agatha["venue"] == "Mitchell Library"
    assert agatha["raw_data"]["category"] == "Living Knowledge Network"
    assert agatha["title"].startswith("Agatha Christie")


# --- recurring series are expanded into the next 30 days (owner 2026-10-24: /events/ looked empty) ---------------------------
from datetime import date  # noqa: E402

from scrapers.glasgow_life_events import EXPAND_DAYS, expand_recurring, occurrences  # noqa: E402

TODAY = date(2026, 10, 23)  # a Friday


def test_weekly_series_gives_every_matching_weekday_in_the_window():
    days = occurrences("Every week on Wednesday from 12th Nov 2025 until 21st Dec 2026", date(2025, 11, 12), date(2026, 12, 21), TODAY)
    assert [d.isoformat() for d in days] == ["2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18"]
    assert all(d.weekday() == 2 for d in days)


def test_window_is_30_days_and_never_after_until_or_before_the_first_date():
    assert EXPAND_DAYS == 30
    assert occurrences("Every week on Thursday from 8th Jan 2026 until 5th Nov 2026", date(2026, 1, 8), date(2026, 11, 5), TODAY) == [date(2026, 10, 29), date(2026, 11, 5)]
    future = occurrences("Every week on Sunday from 8th Nov 2026", date(2026, 11, 8), None, TODAY)
    assert future[0] == date(2026, 11, 8) and future[-1] <= date(2026, 11, 22)


def test_monthly_nth_weekday():
    days = occurrences("Every month on the 1st Monday from 5th Jan 2026 until 6th Dec 2026", date(2026, 1, 5), date(2026, 12, 6), TODAY)
    assert days == [date(2026, 11, 2)]  # 1st Monday of November; December's (7th) is past 'until' and outside the window


def test_unknown_shapes_are_left_alone_not_guessed():
    assert occurrences("Every other Friday from 1st Jan 2026", date(2026, 1, 1), None, TODAY) is None


def test_real_listing_expands_every_recurring_card_and_fills_the_next_month():
    plain = parse_pages("glasgow_life", PAGE, "Europe/London", today=TODAY)
    series_cards = [r for r in parse_listing("glasgow_life", PAGE, "Europe/London") if r["raw_data"]["kind"] == "recurring"]
    assert series_cards, "the fixture is expected to contain recurring cards"
    occ = [r for r in plain if r["raw_data"]["kind"] == "recurring_occurrence"]
    assert len(occ) >= len(series_cards)  # at least one upcoming date for most series, several for the weekly ones
    for r in occ:
        d = date.fromisoformat(r["raw_data"]["occurrence_date"])
        assert TODAY <= d <= date(2026, 11, 22)
        assert r["ends_at"] is None and r["starts_at"].startswith(r["raw_data"]["occurrence_date"])
        assert r["url"].startswith("https://www.glasgowlife.org.uk/event/")
    # one record per series+date, so the same occurrence never lands twice
    assert len({r["content_hash"] for r in occ}) == len(occ)
    # no series-start record from 2025 is left behind for a series that was expanded
    assert not [r for r in plain if r["raw_data"]["kind"] == "recurring"]


def test_expand_recurring_passes_other_kinds_through():
    single = parse_listing("glasgow_life", PAGE, "Europe/London")[0]
    if single["raw_data"]["kind"] != "recurring":
        assert expand_recurring(single, "Europe/London", TODAY) == [single]


# --- detail pages: real description for the writer (2026-10-24; was title+venue+date only, so the model padded) ---------------
import json  # noqa: E402

from scrapers import glasgow_life_events as gle  # noqa: E402

DETAIL = (Path(__file__).parent / "fixtures" / "glasgow_life_event_detail.html").read_bytes()


def test_parse_detail_keeps_description_tickets_and_age_and_times():
    d = gle.parse_detail(DETAIL)
    assert set(d) == {"description", "tickets", "age", "dates_times"}  # dates_times: the clock time, see detail_clock
    assert d["description"].startswith("Greater Govanhill presents MUMS")
    assert "maternal time" in d["description"]
    assert len(d["description"]) <= gle.MAX_DESCRIPTION_CHARS
    assert d["tickets"] == "Free - Drop-in - no ticket required"
    assert d["age"] == "All ages"
    assert "Accessible toilets" not in d["description"]  # the accessibility boilerplate is outside the article body


def test_parse_detail_of_an_empty_page_is_empty():
    assert gle.parse_detail(b"<html><body><p>nothing here</p></body></html>") == {}


def test_long_description_is_cut_at_a_sentence_boundary():
    para = " ".join(f"Sentence number {i} says something." for i in range(200))
    page = f'<div class="editor editor--article"><p>{para}</p></div>'.encode()
    text = gle.parse_detail(page)["description"]
    assert len(text) <= gle.MAX_DESCRIPTION_CHARS and text.endswith(".")


def test_details_section_reaches_the_records_and_is_not_parsed_as_a_listing():
    first = parse_listing("glasgow_life", PAGE, TZ)[0]
    href = first["raw_data"]["uid"]
    blob = PAGE + gle._PAGE_SEPARATOR + gle._DETAIL_MARKER + json.dumps({href: {"description": "Real text.", "age": "All ages"}}).encode()
    recs = parse_pages("glasgow_life", blob, TZ, today=TODAY)
    mine = [r for r in recs if r["raw_data"]["uid"] == href]
    assert mine and all(r["raw_data"]["description"] == "Real text." and r["raw_data"]["age"] == "All ages" for r in mine)
    others = [r for r in recs if r["raw_data"]["uid"] != href]
    assert others and all("description" not in r["raw_data"] for r in others)


def test_a_broken_details_section_is_skipped_not_fatal():
    blob = PAGE + gle._PAGE_SEPARATOR + gle._DETAIL_MARKER + b"{not json"
    assert len(parse_pages("glasgow_life", blob, TZ, today=TODAY)) == len(parse_pages("glasgow_life", PAGE, TZ, today=TODAY))


def test_fetch_reads_each_distinct_event_page_once_and_survives_a_failing_one(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, content): self.content = content
        def raise_for_status(self): pass

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        if "/event/" in url and "agatha" in url:
            raise RuntimeError("boom")
        return Resp(PAGE if "/event/" not in url else DETAIL)

    monkeypatch.setattr(gle.requests, "get", fake_get)
    monkeypatch.setattr(gle.time, "sleep", lambda s: None)
    blob = gle.fetch_pages({"detail_pages": True, "urls": ["https://www.glasgowlife.org.uk/whats-on", "https://www.glasgowlife.org.uk/whats-on?channel=x"]}, {})
    event_calls = [c for c in calls if "/event/" in c]
    assert len(event_calls) == len(set(event_calls)) == 41
    recs = parse_pages("glasgow_life", blob, TZ, today=TODAY)
    agatha = next(r for r in recs if "agatha-christie" in r["url"])
    assert "description" not in agatha["raw_data"]
    other = next(r for r in recs if "agatha-christie" not in r["url"])
    assert other["raw_data"]["description"].startswith("Greater Govanhill")


def test_detail_pages_are_off_unless_the_source_config_asks(monkeypatch):
    calls = []

    class Resp:
        content = PAGE
        def raise_for_status(self): pass

    monkeypatch.setattr(gle.requests, "get", lambda url, headers=None, timeout=None: calls.append(url) or Resp())
    monkeypatch.setattr(gle.time, "sleep", lambda s: None)
    blob = gle.fetch_pages({"urls": ["https://www.glasgowlife.org.uk/whats-on"]}, {})
    assert calls == ["https://www.glasgowlife.org.uk/whats-on"] and gle._DETAIL_MARKER not in blob


# ---- clock time from the detail page's "Dates and times" (owner 2026-10-27) ----------------------------------------
from scrapers.glasgow_life_events import apply_detail_clock, detail_clock, expand_recurring, parse_detail  # noqa: E402


def test_detail_clock_reads_one_time_or_a_dashed_range_and_nothing_else():
    assert detail_clock("Friday 30th - Saturday 31st Oct 2026 7:30pm") == ((19, 30), None)
    assert detail_clock("Every week on Tuesday from 2nd Jun 2026 until 31st Dec 2026 6:00pm") == ((18, 0), None)
    assert detail_clock("Saturday 31st Oct 2026 7:30pm - 9pm") == ((19, 30), (21, 0))
    assert detail_clock("Saturday 31st Oct 2026 10am and 2pm") is None   # two sessions: not guessed
    assert detail_clock("Saturday 31st Oct 2026") is None
    assert detail_clock(None) is None


def test_parse_detail_keeps_dates_and_times():
    html = (b'<div class="event-details__item"><dt>Dates and times</dt><dd>Friday 30th Oct 2026 7:30pm</dd></div>'
            b'<div class="event-details__item"><dt>Venue</dt><dd>Tramway</dd></div>')
    assert parse_detail(html)["dates_times"] == "Friday 30th Oct 2026 7:30pm"


def test_clock_goes_on_date_only_entries_only():
    date_only = {"kind": "single", "starts_at": "2026-10-30T00:00:00+00:00", "ends_at": None}
    out = apply_detail_clock(date_only, ((19, 30), (21, 0)), TZ)
    assert out["starts_at"].startswith("2026-10-30T19:30") and out["ends_at"].startswith("2026-10-30T21:00")
    timed = {"kind": "single", "starts_at": "2026-10-30T11:00:00+00:00", "ends_at": None}
    assert apply_detail_clock(timed, ((19, 30), None), TZ) == timed


def test_expanded_series_occurrences_keep_the_clock():
    rec = {"starts_at": "2026-06-02T18:00:00+01:00", "ends_at": None, "source": "glasgow_life",
           "raw_data": {"uid": "/event/1/x", "kind": "recurring", "recurrence": "Every week on Tuesday from 2nd Jun 2026",
                        "date_text": "Every week on Tuesday from 2nd Jun 2026", "clock": [18, 0, 19, 30]}}
    occ = expand_recurring(rec, TZ, date(2026, 10, 23))
    assert occ and all("T18:00" in o["starts_at"] and "T19:30" in o["ends_at"] for o in occ)


# ---- categories (owner 2026-10-28): venue, then keywords, then plain child/family age text, else Around town ---------
from scrapers.glasgow_life_events import event_category  # noqa: E402


def test_category_from_the_venue_first():
    assert event_category({"age": "Family"}, "Anything", "Partick Library") == "Libraries"
    assert event_category({}, "Concert about art", "Kelvingrove Art Gallery and Museum") == "Museums & exhibitions"
    assert event_category({}, "Duncan Campbell: A New No", "Gallery of Modern Art") == "Museums & exhibitions"
    assert event_category({}, "Van Morrison", "Glasgow Royal Concert Hall") == "Music"
    assert event_category({}, "SCO 26/27: Max Richter+", "City Halls") == "Music"


def test_category_from_keywords_when_the_venue_says_nothing():
    assert event_category({}, "Music for Memories", "Various Locations") == "Music"
    assert event_category({}, "Padel Pay as You Go Programme", "Glasgow Club Scotstoun") == "Sport & leisure"
    assert event_category({}, "Playwriting workshops with John Binnie", None) == "Talks & workshops"
    assert event_category({"description": "A free talk on the tram."}, "Tram history", None) is None  # title only
    # only the opening of the description counts
    assert event_category({"description": "x" * 400 + " a concert"}, "Plain title", None) is None


def test_kids_and_families_is_a_tag_not_a_main_category():
    from scrapers.glasgow_life_events import event_tags
    assert event_category({"age": "Family"}, "Wintering Animals", "Kelvingrove Art Gallery and Museum") == "Museums & exhibitions"
    assert event_tags({"age": "Family"}, "Wintering Animals") == ["Kids & families"]
    assert event_category({"age": "Pre-5"}, "Play", "Various Locations") is None


def test_tag_when_the_text_plainly_addresses_children_or_families():
    from scrapers.glasgow_life_events import event_tags
    assert event_tags({"age": "All ages, Pre-5, Family"}, "Infant Feeding Support Groups") == ["Kids & families"]
    assert event_tags({"age": "5-11 years"}, "Craft") == ["Kids & families"]
    assert event_tags({"description": "Storytime and songs for toddlers and their grown-ups."}, "Wee Rhymes") == ["Kids & families"]
    assert event_tags({}, "Family Fun Day at the Riverside") == ["Kids & families"]
    assert event_tags({}, "Family history: tracing your ancestors") == []
    assert event_tags({"age": "16+ years"}, "Craft") == []
    assert event_tags({"age": "All ages"}, "Craft") == []
    assert event_tags({"age": "See age restrictions"}, "Chess Club") == []


def test_an_entry_rule_about_under_16s_is_not_a_kids_event():
    # Van Morrison / Lang Lang were labelled "Kids & families" by this line (found when backfilling 2026-10-28)
    from scrapers.glasgow_life_events import event_tags
    for age in ("Under 16s must be accompanied by an adult.", "Under 16s must be accompanied by an adult., 15+",
                "All children must be accompanied by an adult"):
        assert event_tags({"age": age}, "Some show") == []
    assert event_tags({"description": "Under 16s must be accompanied by an adult."}, "Van Morrison") == []


def test_channel_pages_tag_and_merge_into_one_record_per_event():
    card = (b'<article class="swiper-card"><a class="card__link" href="/event/1/x">X</a>'
            b'<div class="card__meta">Saturday 31st Oct 2026 11:00am</div><div class="card__meta">Venue</div></article>')
    blob = card + b"\n--GLPAGE--\n<!--GLCHANNEL:Libraries-->\n" + card + b"\n--GLPAGE--\n<!--GLCHANNEL:Sport-->\n" + card
    recs = parse_pages("glasgow_life", blob, TZ, today=date(2026, 10, 23))
    assert len(recs) == 1
    assert recs[0]["raw_data"]["channels"] == ["Libraries", "Sport"]
    



# --- "Clip n� Climb" (owner 2026-11-08): the apostrophe is U+2019, not a broken character --------------------------------------
def test_curly_apostrophe_survives_and_no_replacement_character_anywhere():
    """The stored title and the built page carry U+2019 (the source sends `&#x2019;`); the `�` in the owner's terminal was the console's
    code page, not the data. Guards both the entity form (the fixture) and raw UTF-8 bytes in a card."""
    recs = parse_listing("glasgow_life", PAGE, TZ)
    clip = next(r for r in recs if "Clip n" in r["title"])
    assert clip["title"] == "Autism Friendly sessions for Clip n’ Climb and Soft Play"
    assert not any("�" in str(v) for r in recs for v in (r["title"], r.get("venue"), r["raw_data"].get("category")))
    raw = PAGE.replace("Clip n&#x2019; Climb".encode(), "Clip n’ Climb".encode("utf-8"))
    assert raw != PAGE
    again = next(r for r in parse_listing("glasgow_life", raw, TZ) if "Clip n" in r["title"])
    assert again["title"] == clip["title"]
