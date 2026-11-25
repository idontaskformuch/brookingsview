"""scrapers/facility_hours.py on verbatim excerpts of the real pages (tests/fixtures/facility_hours/, read 2026-11-25)."""
from datetime import date
from pathlib import Path

from scrapers.facility_hours import (catalog_detail_links, name_key, parse_catalog_detail, parse_libcal_weeks)

FIX = Path(__file__).parent / "fixtures" / "facility_hours"


def _read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_catalog_list_page_one_gives_its_five_detail_pages_once_each():
    links = catalog_detail_links(_read("brookings-catalog-page1.html"))
    assert links == [
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/22nd-Avenue-Fire-Station-2",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Airport-AdministrationARFFSRE-Building-10",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Airport-Terminal-Building-11",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Animal-ControlCommunity-Service-19",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Arrowhead-Park-27",
    ]


def test_catalog_detail_pioneer_park_hours_verbatim():
    url = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Pioneer-Park-33"
    entry = parse_catalog_detail(_read("brookings-pioneer-park-33.html"), url)
    assert entry.name == "Pioneer Park"
    assert entry.hours_text == "Sunrise to 11:00p.m."


def test_name_key_ignores_case_and_punctuation_only():
    assert name_key("Animal Control/Community Service") == name_key("animal control community service")
    assert name_key("Douglas Chittick Com. Gardens") != name_key("Douglas Chittick Community Gardens")


def test_libcal_dated_days_briggs_thanksgiving_week():
    days = parse_libcal_weeks(_read("libcal-sdstate-hours.html"), date(2026, 11, 25))
    # The week of 2026-11-22 as the page states it: Sun 12pm-12am, Mon 7:45am-12am, Tue 7:45am-9pm, Wed 8am-5pm, Thu-Sat Closed.
    assert days["2026-11-22"] == ("12:00", "00:00")
    assert days["2026-11-23"] == ("07:45", "00:00")
    assert days["2026-11-24"] == ("07:45", "21:00")
    assert days["2026-11-25"] == ("08:00", "17:00")
    assert days["2026-11-26"] is None and days["2026-11-28"] is None
    # The week after: Sun 12pm-12am ... Fri 7:45am-9pm, Sat 10am-9pm
    assert days["2026-12-04"] == ("07:45", "21:00") and days["2026-12-05"] == ("10:00", "21:00")
    # From Dec 17 the page shows "–" (no hours set yet): unknown, left out, never "closed".
    assert len(days) == 25 and "2026-12-17" not in days


def test_libcal_year_rolls_over_at_new_year():
    page = _read("libcal-sdstate-hours.html").replace("Nov 22", "Dec 31").replace("Nov 23", "Jan 01")
    days = parse_libcal_weeks(page, date(2026, 12, 20))
    assert "2026-12-31" in days and "2027-01-01" in days


def test_broomfield_court_business_hours_label():
    from scrapers.facility_hours import hours_block_text
    text = hours_block_text(_read("broomfield-court-services-hours.html"))
    assert text.startswith("Monday–Friday, 7:30 a.m.–4:30 p.m. (closed for lunch 11:30 a.m.–12:30 p.m.)")


def test_holiday_banner_alone_is_not_hours():
    from scrapers.facility_hours import hours_block_text
    # The banner on every broomfield.org page (2026-11-25): "Hours" is not followed by a day.
    assert hours_block_text("<h2>Holiday Adjusted Hours</h2><p>In observance of Thanksgiving, this facility may be closed</p>") is None
