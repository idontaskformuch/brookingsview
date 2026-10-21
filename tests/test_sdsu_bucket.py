"""Hobo Week events are SDSU campus programming, not Arts & Culture."""
import pytest

from scrapers.parsers.sdsu_events_v1 import _bucket_for


@pytest.mark.parametrize("title", [
    "Hobo Day Committee (HDC) Bum Over",
    "Hobo Day Committee (HDC) Bum Over - Winning Displays",
    "University Program Council (UPC) - HOBO Bingo",
    "Hobo Day Committee (HDC) Bum Alum Social",
    "Hobo Day Committee (HDC) Rally at the Rails",
    "Hobo Day Committee (HDC) Bum Fire",
    "Bum- A - Meal - Registration Table",
    "Bum Over - Winning Shanty Display",
])
def test_hobo_week_events_are_campus(title):
    assert _bucket_for("Special Events", "University Student Union", title) == "university"


@pytest.mark.parametrize("title,category,location", [
    ("BCT Fall Show - Dearly Beloved", "Theatre/Dance", "The Oscar Larson Performing Arts Center"),
    ("Steiger Manson Recital", "Music", "The Oscar Larson Performing Arts Center"),
    ("Museum Shop Yule Market Opens", None, "South Dakota Art Museum"),
    ("Dirty Lil's Disco", "Special Events", "University Student Union"),
])
def test_arts_events_unchanged(title, category, location):
    assert _bucket_for(category, location, title) == "arts_culture"


def test_athletics_still_university():
    assert _bucket_for("Athletics", "Stanley J. Marshall Center", "VB vs USD") == "university"


# --- date rule: SDSU "Special Events" during Hobo Week -> campus ------------
from datetime import datetime
from zoneinfo import ZoneInfo

from scrapers.parsers.sdsu_events_v1 import apply_hobo_week, hobo_day_date

_CT = ZoneInfo("America/Chicago")


def _row(title, day, hour, category="Special Events", bucket="arts_culture"):
    return {"title": title, "starts_at": datetime(2026, 10, day, hour, tzinfo=_CT),
            "primary_category": category, "bucket": bucket}


def _week():
    return [
        _row("Hobo Day Committee (HDC) Bum Alum Social", 23, 17),
        _row("University Program Council (UPC) - Mulligan Stew", 22, 20),
        _row("SDSU Alumni + Foundation - Board of Trustees Dinner", 22, 17),
        _row("Dirty Lil's Disco", 23, 19),
        _row("The Weary Will Chill", 24, 19),
        _row("Dylan Hartman Recital", 25, 16, "Music"),
        _row("Annual SDSU Jazz Second Option", 19, 19, "Music"),
        _row("Special Events before the week", 16, 12),
        _row("Special Events a day later", 25, 12),
    ]


def test_hobo_day_is_the_saturday_after_the_last_committee_event():
    assert hobo_day_date(_week()).isoformat() == "2026-10-24"
    assert hobo_day_date([_row("Dylan Hartman Recital", 25, 16, "Music")]) is None


def test_special_events_in_hobo_week_go_to_campus():
    rows = _week()
    apply_hobo_week(rows)
    by = {r["title"]: r["bucket"] for r in rows}
    assert by["University Program Council (UPC) - Mulligan Stew"] == "university"
    assert by["SDSU Alumni + Foundation - Board of Trustees Dinner"] == "university"
    assert by["Dirty Lil's Disco"] == "university"
    assert by["The Weary Will Chill"] == "university"
    # outside the window, or not "Special Events", nothing changes
    assert by["Special Events before the week"] == "arts_culture"
    assert by["Special Events a day later"] == "arts_culture"
    assert by["Dylan Hartman Recital"] == "arts_culture"
    assert by["Annual SDSU Jazz Second Option"] == "arts_culture"


def test_no_committee_events_means_no_change():
    rows = [_row("Dirty Lil's Disco", 23, 19)]
    apply_hobo_week(rows)
    assert rows[0]["bucket"] == "arts_culture"
