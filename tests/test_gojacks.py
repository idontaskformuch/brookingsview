"""Regression tests for scrapers/parsers/gojacks_v1.py -- see
NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild" for the timezone bug
this guards against (games stored as naive datetimes, silently treated as
UTC on insert, ~5-6h off from real Central time for every game)."""
from datetime import datetime
from zoneinfo import ZoneInfo

from scrapers.parsers.gojacks_v1 import _parse_datetime, normalize_opponent

CENTRAL = ZoneInfo("America/Chicago")


def test_parsed_datetime_is_tz_aware_central():
    iso = _parse_datetime("Oct 29 (Wed)", "6 p.m.", 2025, False)
    dt = datetime.fromisoformat(iso)
    assert dt.tzinfo is not None
    assert dt.astimezone(CENTRAL).hour == 18


def test_parsed_datetime_round_trips_to_utc_correctly():
    # A game listed as "6 p.m." Central on Oct 29 (CDT, UTC-5) must be the
    # true 23:00 UTC instant, not 18:00 UTC (the pre-fix bug).
    iso = _parse_datetime("Oct 29 (Wed)", "6 p.m.", 2025, False)
    dt = datetime.fromisoformat(iso)
    assert dt.astimezone(ZoneInfo("UTC")).hour == 23


def test_dual_zone_listing_prefers_ct_over_first_token():
    # Real observed source shape: "6 p.m. MT / 7 p.m. CT" -- must use 7pm
    # Central, not the first (Mountain) figure.
    iso = _parse_datetime("Nov 15 (Sat)", "6 p.m. MT / 7 p.m. CT", 2025, False)
    dt = datetime.fromisoformat(iso)
    assert dt.astimezone(CENTRAL).hour == 19


def test_plain_unlabeled_time_is_treated_as_central():
    iso = _parse_datetime("Nov 3 (Mon)", "8 p.m.", 2025, False)
    dt = datetime.fromisoformat(iso)
    assert dt.astimezone(CENTRAL).hour == 20


def test_season_spanning_two_years_still_gets_correct_tz():
    iso = _parse_datetime("Jan 15 (Thu)", "7 p.m.", 2025, True)
    dt = datetime.fromisoformat(iso)
    assert dt.year == 2026
    assert dt.astimezone(CENTRAL).hour == 19


def test_normalize_opponent_strips_hash_rank():
    assert normalize_opponent("#1 Nebraska") == "Nebraska"
    assert normalize_opponent("#14 Minnesota") == "Minnesota"


def test_normalize_opponent_strips_dual_poll_rank():
    assert normalize_opponent("#1/2 Arizona") == "Arizona"
    assert normalize_opponent("#12/10 North Carolina") == "North Carolina"


def test_normalize_opponent_strips_rv():
    assert normalize_opponent("RV Villanova") == "Villanova"
    assert normalize_opponent("-/RV Creighton") == "Creighton"


def test_normalize_opponent_strips_no_dot_rank():
    assert normalize_opponent("No. 3 South Dakota") == "South Dakota"


def test_normalize_opponent_strips_stacked_prefixes():
    assert normalize_opponent("-/RV No. 1 North Dakota State") == "North Dakota State"


def test_normalize_opponent_leaves_unranked_name_unchanged():
    assert normalize_opponent("Nebraska") == "Nebraska"
    assert normalize_opponent("Second Line Showcase") == "Second Line Showcase"


def test_ranking_change_does_not_change_content_hash_identity():
    # The actual bug: "Nebraska" and "#1 Nebraska" on the same date used to
    # hash differently and duplicate. normalize_opponent() is what
    # content_hash is now keyed on for the opponent field -- confirm both
    # variants normalize identically.
    assert normalize_opponent("Nebraska") == normalize_opponent("#1 Nebraska")
    assert normalize_opponent("Villanova") == normalize_opponent("RV Villanova")
