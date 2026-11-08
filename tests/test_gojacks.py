"""Regression tests for scrapers/parsers/gojacks_v1.py -- see
NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild" for the timezone bug
this guards against (games stored as naive datetimes, silently treated as
UTC on insert, ~5-6h off from real Central time for every game)."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from scrapers.parsers.gojacks_v1 import _parse_datetime, normalize_opponent, parse_time_cell

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


# Every time-cell shape seen in sports_games and the 2026 schedule fixtures (2026-11-08) -> Central (hour, minute), None = no usable time.
@pytest.mark.parametrize("cell,expected", [
    ("7 p.m.", (19, 0)), ("7:00 p.m.", (19, 0)), ("1:30 PM", (13, 30)), ("11:00 a.m.", (11, 0)), ("9 p.m.", (21, 0)),
    ("Noon", (12, 0)), ("noon", (12, 0)), ("Approximately 2:30 p.m.", (14, 30)),
    ("10 a.m. PT / noon CT", (12, 0)),            # was read as 10:00: the CT figure is a word, not digits
    ("6 p.m. MT / 7 p.m. CT", (19, 0)), ("2 p.m. MT / 3 p.m. CT", (15, 0)), ("3 p.m. PT / 5 p.m. CT", (17, 0)),
    ("5 p.m. PT / 7 p.m. CT", (19, 0)), ("6 p.m. PT / 8 p.m. CT", (20, 0)),
    ("6 p.m. CT / 7 p.m. ET", (18, 0)), ("10 a.m. CT / 11 a.m. ET", (10, 0)), ("12:15 p.m. CT / 1 p.m. ET", (12, 15)),
    ("7 p.m. ET", (18, 0)), ("5 p.m. MT", (18, 0)), ("5 p.m. PT", (19, 0)),   # only another zone labeled: converted to Central
    ("11:30 p.m. PT", None),                      # would cross midnight: not guessed
    ("TBD", None), ("TBA", None), ("", None), (None, None), ("   ", None), ("Postponed", None),
])
def test_parse_time_cell(cell, expected):
    assert parse_time_cell(cell) == expected


def test_legacy_datetime_keeps_noon_placeholder_for_tba_and_fixes_pt_ct():
    noon = lambda cell: datetime.fromisoformat(_parse_datetime("Aug 30 (Sun)", cell, 2026, False)).astimezone(CENTRAL).hour
    assert noon("10 a.m. PT / noon CT") == 12 and noon("TBD") == 12 and noon("") == 12 and noon("Noon") == 12
