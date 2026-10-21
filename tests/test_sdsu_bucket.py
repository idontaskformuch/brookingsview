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
