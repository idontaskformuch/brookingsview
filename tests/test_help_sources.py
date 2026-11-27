"""/help/ step 1b (owner 2026-11-27): one deterministic parser per confirmed source. The fixtures are the pages as PoliteFetcher fetched
them on 2026-11-27 (byte copies of that day's cache, ledger .claude/fetch-ledger/2026-11-27.jsonl), so every expected value below
stands on those pages (CLAUDE.md rule 15). jacks_cupboard.html is llm_excluded (sdstate.edu): parsed by regex only.
As in test_watch_sources.py, each fixture is the page without its <script> blocks and with public key values emptied (data-sitekey,
?key=), because gitleaks refuses the pages' embedded browser keys; source_text() of every fixture equals that of the fetched page.
Day of week: 0 = Sunday (place_hours). TODAY is the day of the fetch; dated rows run 8 weeks ahead (decision 3)."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from db import help_places as hp
from scrapers import help_sources as hs

FIX = Path(__file__).resolve().parent / "fixtures" / "help_sources_2026-11-27"
TODAY = date(2026, 11, 27)
SUN, MON, TUE, WED, THU, FRI, SAT = range(7)


def run(source_id: str):
    src = hs.SOURCE_BY_ID[source_id]
    pages = {url: (FIX / name).read_bytes() for url, name in src.fixtures.items()}
    return hs.parse(src, pages, TODAY)


def by_name(rows, needle):
    [row] = [r for r in rows if needle in r.entry.name]
    return row


def decisions(rows):
    return [r.decision for r in rows]


# --- shared helpers --------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("text, hhmm", [("2:00 PM", "14:00"), ("10 AM", "10:00"), ("8: 00 AM", "08:00"), ("noon", "12:00"),
                                        ("8.30am", "08:30"), ("5.00pm", "17:00"), ("12:00", "12:00"), ("1pm", "13:00")])
def test_time(text, hhmm):
    # each spelling is on one of the fixture pages ("8: 00 AM" = Joseph Project on moval_food_pantries.html)
    assert hs.parse_time(text) == hhmm


def test_monthly_rule_becomes_dates_eight_weeks_ahead():
    assert hs.monthly_dates("Every 2nd and 4th Saturday", TODAY) == [date(2026, 11, 28), date(2026, 12, 12), date(2026, 12, 26),
                                                                      date(2027, 1, 9)]
    assert hs.monthly_dates("On the 1st and 3rd Tuesdays of the month", TODAY) == [date(2026, 12, 1), date(2026, 12, 15),
                                                                                    date(2027, 1, 5), date(2027, 1, 19)]
    assert hs.monthly_dates("Every other Monday", TODAY) is None   # no start date on the page: cannot be placed


def test_a_date_without_year_takes_the_year_its_weekday_names():
    assert hs.resolve_date(11, 26, "Thursday", TODAY) == date(2026, 11, 26)   # broomfieldfish.html
    assert hs.resolve_date(1, 1, "Friday", TODAY) == date(2027, 1, 1)         # broomfieldfish.html
    # moval.gov/pantryproject (fetched 2026-11-27): "Tuesday, November 25" is 2025, the page is a year old
    assert hs.resolve_date(11, 25, "Tuesday", TODAY) == date(2025, 11, 25)


# --- Trussell Trust template (Glasgow SW, NE, NW) ---------------------------------------------------------------------------------
def test_trussell_sw_five_centres_with_referral_and_postcode():
    rows = run("glasgow-sw-foodbank")
    assert [r.entry.name for r in rows] == ["Glasgow SW Foodbank – Ibrox", "Glasgow SW Foodbank – Penilee",
                                            "Glasgow SW Foodbank – Linthouse", "Glasgow SW Foodbank – Priesthill",
                                            "Glasgow SW Foodbank – Cardonald"]
    ibrox = rows[0]
    assert ibrox.weekly == ((MON, "12:00", "14:00"),)
    assert (ibrox.entry.street_address, ibrox.entry.postal_code) == ("67 Clifford Street", "G51 1QH")
    assert ibrox.entry.requirements_note == "In line with Trussell Trust policy, our Foodbank Centres use a voucher referral system."
    assert ibrox.entry.area_name is None   # SW addresses have no area line; the heading is not taken as one
    assert decisions(rows) == ["publish"] * 5


def test_trussell_ne_six_centres_area_from_the_address():
    rows = run("glasgow-ne-foodbank")
    assert len(rows) == 6   # Parkhead is in the footer too: one row
    parkhead = by_name(rows, "Parkhead")
    assert parkhead.weekly == ((MON, "13:00", "15:00"), (WED, "10:30", "12:30"), (FRI, "13:00", "15:00"))
    assert parkhead.entry.area_name == "Parkhead"
    assert by_name(rows, "The Story Coffee").entry.area_name == "Bridgeton"   # "Glasgow / Bridgeton / G40 1QH"
    assert parkhead.entry.requirements_note == ("In order to get help from our foodbank, you will need a voucher issued by "
                                                "local agencies.")
    assert decisions(rows) == ["publish"] * 6


def test_trussell_nw_two_centres():
    rows = run("glasgow-nw-foodbank")
    blaw = by_name(rows, "Blawarthill")
    assert blaw.weekly == ((TUE, "12:00", "14:00"), (FRI, "12:00", "14:00"))
    assert (blaw.entry.area_name, blaw.entry.postal_code) == ("Scotstoun", "G14 0EP")
    assert decisions(rows) == ["publish"] * 2


def test_trussell_page_without_the_table_is_a_parse_error():
    src = hs.SOURCE_BY_ID["glasgow-sw-foodbank"]
    body = (FIX / "glasgowsw_locations.html").read_bytes().replace(b"location__opening-times", b"x")
    with pytest.raises(hs.ParseError):
        hs.parse(src, {src.url: body}, TODAY)


# --- Glasgow: Social Bite --------------------------------------------------------------------------------------------------------
def test_social_bite_free_food_times_not_the_shop_hours():
    [row] = run("social-bite-glasgow")
    weekdays = [(d, "08:30", "09:30") for d in (MON, TUE, WED, THU, FRI)] + [(d, "17:00", "18:00") for d in (MON, TUE, WED, THU, FRI)]
    assert set(row.weekly) == set(weekdays) | {(WED, "16:45", "17:45")}   # Women's Supper (women only) stays in hours_text only
    assert "Women's Supper" in row.hours_text
    assert (row.entry.street_address, row.entry.postal_code, row.entry.category) == ("10 Sauchiehall St", "G2 3GF", "meal_program")
    assert row.decision == "publish"


# --- Moreno Valley ---------------------------------------------------------------------------------------------------------------
def test_moval_sixteen_pantries():
    rows = run("moval-food-pantries")
    assert len(rows) == 16
    assert by_name(rows, "Al Rahma").weekly == ((FRI, "14:00", "17:00"),)
    assert by_name(rows, "Joseph Project").weekly == ((THU, "08:00", "12:00"),)
    assert by_name(rows, "Al Rahma").entry.street_address == "12125 Day Street, Suite T102"
    assert by_name(rows, "Church of Christ").entry.requirements_note == "Must call in advance"


def test_moval_monthly_patterns_become_dated_rows():
    rows = run("moval-food-pantries")
    crossword = by_name(rows, "Crossword")
    assert crossword.entry.schedule_rule == "Every 2nd and 4th Saturday"
    assert [d for d, _, _ in crossword.dates] == [date(2026, 11, 28), date(2026, 12, 12), date(2026, 12, 26), date(2027, 1, 9)]
    assert crossword.dates[0][1:] == ("10:00", "11:00")
    fa = by_name(rows, "Feeding America")
    assert [d for d, _, _ in fa.dates] == [date(2026, 12, 10), date(2027, 1, 14)]
    assert fa.entry.requirements_note.startswith("Distribution participants must live within Riverside and San Bernardino counties")


def test_moval_rows_the_owner_must_see_first_are_queued():
    rows = run("moval-food-pantries")
    assert by_name(rows, "SDA").decision == "queue"           # "Every other Monday": no start date
    assert by_name(rows, "RCCD").decision == "queue"          # Summer Hours and School Year Hours, no dates for either
    assert decisions(rows).count("publish") == 14


def test_moval_warm_centers_are_queued_while_the_page_is_stale():
    rows = run("moval-warm")
    assert [r.entry.name for r in rows] == ["Cottonwood Golf Center", "Senior Center", "Moreno Valley Public Library - Main",
                                            "Library – Iris Branch"]
    assert all(r.decision == "queue" and "masks" in r.why for r in rows)
    assert by_name(rows, "Senior Center").entry.audience_tags == ("seniors",)
    assert by_name(rows, "Iris").weekly[0] == (MON, "10:00", "20:00")


# --- Brookings -------------------------------------------------------------------------------------------------------------------
def test_brookings_county_food_pantry():
    [row] = run("brookings-county-food-pantry")
    assert row.weekly == ((MON, "13:00", "16:30"), (WED, "13:00", "16:30"), (FRI, "13:00", "16:30"))
    assert row.closed == ((date(2026, 11, 27), "Thanksgiving Holiday"), (date(2026, 12, 25), "Christmas Holiday"))
    assert row.decision == "publish"


def test_feeding_brookings():
    [row] = run("feeding-brookings")
    assert row.weekly == ((THU, "15:00", "17:00"),)
    assert row.entry.town_evidence == "Ascension Lutheran Church in Brookings, SD"
    assert row.decision == "publish"


def test_jacks_cupboard_students_only():
    [row] = run("jacks-cupboard")
    assert row.weekly == ((TUE, "15:00", "18:00"), (WED, "15:00", "18:00"))
    assert row.entry.audience_tags == ("students",)
    assert row.entry.requirements_note == "Currently enrolled SDSU students"
    assert row.entry.address == "Ben Reifel Hall (south side)"   # the Location: line only, not the sentence after it
    assert row.decision == "publish"


def test_harvest_table_names_no_town_and_is_rejected():
    [row] = run("harvest-table")
    assert row.decision == "reject" and "town:" in row.why
    assert [d for d, _, _ in row.dates] == [date(2026, 11, 30), date(2026, 12, 7), date(2026, 12, 14), date(2026, 12, 21),
                                            date(2027, 1, 4), date(2027, 1, 11), date(2027, 1, 18)]
    assert row.closed == ((date(2026, 12, 28), "No Meal Served"),)


# --- Broomfield ------------------------------------------------------------------------------------------------------------------
def test_broomfield_fish_week_and_closures():
    [row] = run("broomfield-fish")
    assert row.weekly == ((MON, "12:00", "16:30"), (TUE, "10:00", "15:30"), (WED, "13:00", "18:00"), (FRI, "12:00", "16:30"))
    assert [d for d, _ in row.closed] == [date(2026, 11, 27), date(2026, 12, 24), date(2026, 12, 25), date(2027, 1, 1)]
    assert row.entry.town_evidence == "6 Garden Center Broomfield, CO 80020"
    assert row.decision == "publish"


def test_north_denver_cares():
    [row] = run("north-denver-cares")
    assert row.weekly == ((TUE, "10:00", "16:00"), (WED, "10:00", "14:00"), (THU, "09:00", "13:00"))
    assert row.entry.requirements_note == "Photo ID; Proof of Income; Proof of Residence"
    assert row.decision == "publish"


def test_cross_of_christ_meal_days_without_times():
    [row] = run("cross-of-christ-meals")
    assert [d for d, _, _ in row.dates] == [date(2026, 12, 1), date(2026, 12, 15), date(2027, 1, 5), date(2027, 1, 19)]
    assert all(o is None and c is None for _, o, c in row.dates)   # no time on the page: days only
    assert row.decision == "publish"


def test_every_published_row_validates_against_its_own_page():
    for src in hs.SOURCES:
        for row in run(src.id):
            if row.decision == "publish":
                assert hp.validate(row.entry, row.page_text) == [], (src.id, row.entry.name)
                assert row.weekly or row.dates, (src.id, row.entry.name)   # never a published row without confirmed days
