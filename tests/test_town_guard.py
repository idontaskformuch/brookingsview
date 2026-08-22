"""Regression tests for ai_pipeline/town_guard.py -- the cross-site
contamination gate. Mandatory per the August 2026 editorial audit: one
clean + one contaminated fixture article per town, proving the gate blocks
the contaminated one and passes the clean one.

Fixture articles below are hand-written, not pulled from the DB, so these
tests never depend on live data or network/DB access.
"""
from ai_pipeline.town_guard import (
    ALL_TOWN_IDS, addressed_reader_hits, validate_town_identity,
)

MORENO_VALLEY_CLEAN = """
This Week in Moreno Valley: Library Programs Return

The Moreno Valley Public Library's Main Branch on Alessandro Boulevard
kicks off its fall storytime series this week, with sessions continuing
through October at both the Main and Iris Plaza branches. Riverside County
residents can register online; the program is free and open to all ages.
"""

MORENO_VALLEY_CONTAMINATED = """
This Week at State: What's On in Brookings

Here in Brookings, South Dakota, SDSU's Barn Owl Blast Marching Festival
returns to campus this weekend, with bands traveling in from as far as
Volga and Elkton along Highway 14.
"""

BROOKINGS_CLEAN = """
City Council Approves Downtown Parking Study

The Brookings City Council voted 6-1 Tuesday night to fund a downtown
parking utilization study, part of ongoing efforts tied to the Sixth
Street reconstruction project. South Dakota State University students
raised concerns about weekend availability during public comment.
"""

BROOKINGS_CONTAMINATED = """
What's Selling in Moreno Valley This Month

Home sales in the Inland Empire continued their summer pace, with
Riverside County recording a median price increase in the 92553 ZIP code,
according to assessor data reviewed by our newsroom.
"""


def test_clean_moreno_valley_article_passes():
    result = validate_town_identity(MORENO_VALLEY_CLEAN, "moreno_valley_ca")
    assert result.passed
    assert result.violations == []


def test_contaminated_moreno_valley_article_is_blocked():
    result = validate_town_identity(MORENO_VALLEY_CONTAMINATED, "moreno_valley_ca")
    assert not result.passed
    assert not result
    joined = " ".join(result.violations)
    assert "Brookings" in joined
    assert "South Dakota" in joined
    assert "SDSU" in joined
    assert "Highway 14" in joined


def test_clean_brookings_article_passes():
    result = validate_town_identity(BROOKINGS_CLEAN, "brookings_sd")
    assert result.passed
    assert result.violations == []


def test_contaminated_brookings_article_is_blocked():
    result = validate_town_identity(BROOKINGS_CONTAMINATED, "brookings_sd")
    assert not result.passed
    joined = " ".join(result.violations)
    assert "Moreno Valley" in joined
    assert "Inland Empire" in joined
    assert "Riverside County" in joined


def test_review_tier_does_not_block():
    # "prairie" is real, common English usage in Moreno Valley content too
    # (e.g. a street name like "Prairie Wind Tr") -- must not hard-fail on
    # its own.
    text = "Two sales closed on Prairie Wind Trail in the 92555 ZIP code."
    result = validate_town_identity(text, "moreno_valley_ca")
    assert result.passed
    assert any("prairie" in r for r in result.reviews)


def test_word_boundary_avoids_substring_false_positives():
    # "951" as a hard-blocklist term for brookings_sd must not fire on an
    # unrelated number that merely contains "951" as a substring.
    text = "The meeting drew 9514 attendees this year, a new record."
    result = validate_town_identity(text, "brookings_sd")
    assert result.passed


def test_addressed_reader_escalation():
    matched = ["Brookings", "South Dakota"]
    text = ("Twelve hundred miles from Brookings, in Moreno Valley, "
            "California, a public library is spending its budget differently. "
            "Here in Brookings, this isn't an abstract concern.")
    escalated = addressed_reader_hits(text, matched)
    assert "Brookings" in escalated


def test_addressed_reader_no_escalation_for_outside_comparison():
    # Rule 3: mentioning the other city as an outside example is fine.
    matched = ["Brookings"]
    text = "Twelve hundred miles from Brookings, a public library made a different choice."
    escalated = addressed_reader_hits(text, matched)
    assert escalated == []


def test_all_town_ids_have_a_blocklist():
    from ai_pipeline.town_guard import HARD_BLOCKLIST
    for town_id in ALL_TOWN_IDS:
        assert HARD_BLOCKLIST.get(town_id), f"{town_id} has no hard blocklist"
