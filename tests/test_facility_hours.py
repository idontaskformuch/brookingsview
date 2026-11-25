"""Regression tests for ai_pipeline/facility_hours.py.

The parseable-vs-flagged fixtures below are the ACTUAL hours_text values
seeded for real facilities across all three towns, confirmed live against
the database 2026-09-04 -- not synthetic strings written to make the parser
look good. 10 of 12 real rows parse cleanly; 2 are genuinely ambiguous and
must be flagged, not guessed.
"""
from ai_pipeline.facility_hours import parse_hours_text


def test_none_and_empty_are_not_flagged_just_have_no_data():
    for raw in (None, "", "   "):
        result = parse_hours_text(raw)
        assert result.structured is None
        assert result.needs_review is False


# --- real data: rows that parse cleanly -------------------------------------

def test_brookings_city_hall_day_range_plus_single_day_with_noon():
    result = parse_hours_text("Mon–Thu 7am–5pm, Fri 7am–noon")
    assert result.needs_review is False
    assert result.structured["monday"] == ("07:00", "17:00")
    assert result.structured["thursday"] == ("07:00", "17:00")
    assert result.structured["friday"] == ("07:00", "12:00")
    # Never mentioned -> closed, the standard posted-hours convention.
    assert result.structured["saturday"] is None
    assert result.structured["sunday"] is None


def test_daily_expands_to_all_seven_days():
    result = parse_hours_text("Daily 6am–11pm")
    assert result.needs_review is False
    for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        assert result.structured[day] == ("06:00", "23:00")


def test_brookings_public_library_three_groups():
    result = parse_hours_text("Mon–Thu 9:30am–9pm, Fri–Sat 9:30am–5:30pm, Sun 1pm–5pm")
    assert result.needs_review is False
    assert result.structured["monday"] == ("09:30", "21:00")
    assert result.structured["friday"] == ("09:30", "17:30")
    assert result.structured["saturday"] == ("09:30", "17:30")
    assert result.structured["sunday"] == ("13:00", "17:00")


def test_broomfield_community_center_ascii_hyphen_not_en_dash():
    result = parse_hours_text("Mon-Thu 5am-10pm, Fri 5am-8pm, Sat 7am-8pm, Sun 8am-6pm")
    assert result.needs_review is False
    assert result.structured["friday"] == ("05:00", "20:00")
    assert result.structured["sunday"] == ("08:00", "18:00")


def test_broomfield_library_ascii_hyphen():
    result = parse_hours_text("Mon-Thu 9am-9pm, Fri-Sat 9am-5pm, Sun 1pm-5pm")
    assert result.needs_review is False
    assert result.structured["saturday"] == ("09:00", "17:00")


def test_paul_derda_rec_center_with_half_hour_minutes():
    result = parse_hours_text("Mon-Thu 5am-10pm, Fri 5am-6:30pm, Sat 7am-8pm, Sun 8am-6pm")
    assert result.needs_review is False
    assert result.structured["friday"] == ("05:00", "18:30")


def test_moreno_valley_main_library_noon_as_start_time():
    result = parse_hours_text("Mon–Thu 9am–8pm, Fri 9am–6pm, Sat 9am–5pm, Sun noon–5pm")
    assert result.needs_review is False
    assert result.structured["sunday"] == ("12:00", "17:00")


def test_lasselle_sports_park_daily_en_dash():
    result = parse_hours_text("Daily 6am–10pm")
    assert result.needs_review is False
    assert result.structured["wednesday"] == ("06:00", "22:00")


def test_iris_plaza_and_mall_branch_library_closed_day_keyword():
    # "closed Sunday" -- the day comes AFTER "closed", a different shape
    # from every other group in this dataset.
    result = parse_hours_text("Mon–Fri 10am–8pm, Sat 10am–6pm, closed Sunday")
    assert result.needs_review is False
    assert result.structured["saturday"] == ("10:00", "18:00")
    assert result.structured["sunday"] is None


# --- real data: rows that must be flagged, not guessed ----------------------

def test_moreno_valley_celebration_park_open_ended_time_is_flagged():
    # "Sun 10am onward" has no close time -- must not be guessed at.
    result = parse_hours_text("Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward")
    assert result.structured is None
    assert result.needs_review is True
    assert "onward" in result.reason or "10am onward" in result.reason


def test_moreno_valley_city_hall_parenthetical_caveat_is_flagged():
    # The core Mon-Fri hours ARE unambiguous, but the trailing parenthetical
    # ("some Development Services counters follow separate Friday hours")
    # is real information that would be silently lost if parsed away --
    # flagged for a human to judge, not dropped.
    result = parse_hours_text(
        "Mon–Thu 7:30am–5:30pm, Fri 7:30am–4:30pm "
        "(some Development Services counters follow separate Friday hours)"
    )
    assert result.structured is None
    assert result.needs_review is True
    assert "parenthetical" in result.reason


def test_completely_unrecognized_text_is_flagged_not_silently_ignored():
    result = parse_hours_text("Call for hours")
    assert result.structured is None
    assert result.needs_review is True


def test_reversed_day_range_is_flagged_not_guessed():
    # A day range that runs backwards in week order (never seen in real
    # data, but must fail safe rather than silently wrap Sun->Mon).
    result = parse_hours_text("Fri-Mon 9am-5pm")
    assert result.structured is None
    assert result.needs_review is True


def test_closing_after_midnight_round_trips_through_check_hours_consistency():
    # The Old Man Bar, Broomfield: "Mon-Sun 11:00 AM - 2:00 AM" (.claude/evidence/venues-2026-11/broomfield/the-old-man.txt,
    # 2026-11-13). hours_text, hours_structured and place_hours must agree with closes < opens, or the invariant flags the row.
    from scripts.check_hours_consistency import compare, table_to_structured
    import datetime as dt

    parsed = parse_hours_text("Mon-Sun 11am-2am")
    assert parsed.structured["monday"] == ("11:00", "02:00")
    rows = [(d, dt.time(11, 0), dt.time(2, 0)) for d in range(7)]
    assert compare(parsed.structured, table_to_structured(rows)) == []
    # Chipper's Lanes Broomfield: "Sun-Thurs: 10 am-11 pm Fri & Sat: 10 am-midnight", written without the wrap-around range
    # the parser does not read ("Sun-Thu" is unrecognized).
    chippers = parse_hours_text("Mon-Thu 10am-11pm, Fri-Sat 10am-midnight, Sun 10am-11pm")
    assert chippers.structured["friday"] == ("10:00", "00:00") and chippers.structured["sunday"] == ("10:00", "23:00")


# --- Order D 1 (2026-11-25): seasons, round-the-clock and "Open daily", verbatim hours_text from the live rows ---------------

def test_art_museum_closed_sundays_january_march_becomes_two_seasons():
    # brookings_sd/south-dakota-art-museum, hours_text as of 2026-11-25
    result = parse_hours_text("Mon-Fri 10 a.m.-5 p.m.; Sat 10 a.m.-4 p.m.; Sun noon-4 p.m. Closed Sundays January-March "
                              "and on all state holidays.")
    assert result.needs_review is False
    winter, rest = result.structured["seasons"]
    assert (winter["from"], winter["to"], winter["label"]) == ("01-01", "03-31", "January\u2013March")
    assert winter["week"]["sunday"] is None and winter["week"]["saturday"] == ("10:00", "16:00")
    assert (rest["from"], rest["to"]) == ("04-01", "12-31")
    assert rest["week"]["sunday"] == ("12:00", "16:00") and rest["week"]["monday"] == ("10:00", "17:00")


def test_ag_heritage_museum_shared_pm_in_one_to_five():
    # brookings_sd/south-dakota-agricultural-heritage-museum: "Sun 1-5 p.m." is 13:00-17:00
    result = parse_hours_text("Mon-Sat 10 a.m.-5 p.m.; Sun 1-5 p.m. Closed Sundays January-March.")
    assert result.needs_review is False
    _, rest = result.structured["seasons"]
    assert rest["week"]["sunday"] == ("13:00", "17:00")


def test_larson_nature_center_labelled_summer_and_rest_of_year():
    # brookings_sd/larson-nature-center; "mid-August" is the 15th by rule (_MONTH_SPEC_RE)
    result = parse_hours_text("Summer (June-mid-August): Wed-Fri noon-8pm, Sat 9am-8pm, Sun noon-8pm. Rest of year: Sat "
                              "9am-5pm, Sun noon-5pm only.")
    assert result.needs_review is False
    summer, rest = result.structured["seasons"]
    assert (summer["from"], summer["to"]) == ("06-01", "08-15")
    assert (rest["from"], rest["to"]) == ("08-16", "05-31")
    assert summer["week"]["wednesday"] == ("12:00", "20:00") and summer["week"]["monday"] is None
    assert rest["week"]["sunday"] == ("12:00", "17:00") and rest["week"]["wednesday"] is None


def test_broomfield_recycling_center_round_the_clock_staff_sentence_is_not_hours():
    # broomfield_co/broomfield-recycling-center (hours_text 2026-11-11)
    result = parse_hours_text("Open 24 hours a day, 7 days a week. Staff can be reached by phone or email Monday to Friday, "
                              "7:30am to 4pm.")
    assert result.needs_review is False
    assert all(result.structured[d] == ("00:00", "23:59") for d in result.structured)


def test_farm_house_open_daily():
    # moreno_valley_ca/farm-house-collective
    result = parse_hours_text("Open daily 11am\u201310pm")
    assert result.needs_review is False
    assert all(result.structured[d] == ("11:00", "22:00") for d in result.structured)


def test_mccrory_seasons_without_dates_stay_flagged():
    # brookings_sd/mccrory-gardens: "Summer"/"Fall/Winter" are not dates; the source must say when they start.
    result = parse_hours_text("Summer: Sun\u2013Sat 10am\u20137pm (last admission 6:30pm); Fall/Winter: Mon\u2013Fri "
                              "10am\u20135pm (last admission 4:30pm). Extended hours for special events and holiday shopping.")
    assert result.structured is None and result.needs_review is True
    assert "without dates" in result.reason


def test_childrens_museum_time_without_days_stays_flagged():
    # brookings_sd/childrens-museum-of-south-dakota
    result = parse_hours_text("Open 10 a.m.-5 p.m.; see the museum's Hours + Admission page for which days.")
    assert result.structured is None and result.needs_review is True


# --- Order D 3: "Sunrise to 11 p.m." --------------------------------------------------------------------------------------

def test_pioneer_park_sunrise_to_eleven_every_day():
    # Brookings facility catalog, Pioneer Park, verbatim (.claude/audit/sources-brookings.md, read 2026-11-25)
    result = parse_hours_text("Sunrise to 11:00p.m.")
    assert result.needs_review is False
    assert all(result.structured[d] == ("sunrise", "23:00") for d in result.structured)


def test_plain_time_without_days_is_still_flagged():
    # Only a sunrise park hour is read as daily without days; the Children's Museum's "Open 10 a.m.-5 p.m." is not.
    assert parse_hours_text("10am-5pm").needs_review is True
