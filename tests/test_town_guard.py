"""Regression tests for ai_pipeline/town_guard.py -- the cross-site
contamination gate. Mandatory per the August 2026 editorial audit: one
clean + one contaminated fixture article per town, proving the gate blocks
the contaminated one and passes the clean one.

Fixture articles below are hand-written, not pulled from the DB, so these
tests never depend on live data or network/DB access.
"""
from ai_pipeline.town_guard import (
    ALL_TOWN_IDS, addressed_reader_hits, has_local_anchor, validate_town_identity,
)

MORENO_VALLEY_CFG = {"display_name": "Moreno Valley"}

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
    assert "SDSU" in joined
    assert "Highway 14" in joined
    # "South Dakota" is deliberately NOT asserted here as a check-1 hit --
    # bare state names were removed from the derived blocklist 2026-09-03
    # (see _self_identity_terms' own docstring: they're a blind, ungrounded
    # match that false-positived on Brookings' real SDSU away-game content).
    # validation/place_state.py (check 2) owns state-level correctness now,
    # SOURCE-GROUNDED -- see test_place_state.py's
    # test_moreno_valley_state_leakage_is_still_caught_by_place_state below
    # for proof this exact contaminated text is still blocked, just by the
    # check actually suited to the job.


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


# --- state-name over-blocking regression (found 2026-09-03 review) ---------
# The config-derived blocklist refactor initially auto-derived every OTHER
# town's full state name (California, Colorado) into brookings_sd's own hard
# blocklist -- confirmed live this blocked ANY mention of "Colorado", with
# no source-grounding at all, which is exactly wrong for Brookings' real
# SDSU athletics content (a genuine away game at a Colorado school). The
# original hand-curated HARD_BLOCKLIST (pre-2026-09-03) never had this
# problem because it never included bare state names for brookings_sd in
# the first place -- confirmed via `git log -p` on this file. Fixed by
# dropping state-name auto-derivation from _self_identity_terms() entirely;
# validation/place_state.py (check 2) now owns state-level correctness,
# correctly grounded against the source record.

def test_sdsu_away_game_state_mention_is_not_blocked():
    # A real, legitimate SDSU Summit League road game -- must NOT be
    # hard-blocked just because it names another fleet town's state.
    text = "The Jackrabbits travel to Denver, Colorado this weekend for a Summit League matchup."
    result = validate_town_identity(text, "brookings_sd")
    assert result.passed


def test_moreno_valley_away_game_style_mention_of_south_dakota_is_not_blocked():
    # Same risk, other direction -- confirmed symmetric, not just fixed for
    # the one town that happened to trigger the original finding.
    text = "The visiting team traveled in from South Dakota for the tournament."
    result = validate_town_identity(text, "moreno_valley_ca")
    assert result.passed


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


# --- config-driven blocklist (Recurring-traffic layer handoff, Phase 0) ----
# HARD_BLOCKLIST/REVIEW_BLOCKLIST used to be hand-maintained per-town Python
# dicts; a real, live asymmetric gap was found 2026-09-03 (broomfield_co's
# list was missing several moreno_valley_ca terms brookings_sd's list
# already had) precisely because nothing forced every town's list to stay in
# sync when one was edited. Now derived from configs/*.json -- these tests
# exercise the derivation logic directly (via _build_hard_blocklist's
# injectable `configs` param), not the real on-disk config files, so a
# "strengthens automatically as towns are added" claim is provable without
# touching the real fleet.

def test_new_town_config_is_protected_with_no_code_change():
    from ai_pipeline.town_guard import _build_hard_blocklist
    configs = {
        "brookings_sd": {"display_name": "Brookings", "state": "SD"},
        "new_town_xy": {"display_name": "New Town", "state": "SD",
                         "identity": {"terms": ["Old Mill Road"]}},
    }
    blocklist = _build_hard_blocklist(configs)
    assert "New Town" in blocklist["brookings_sd"]
    assert "Old Mill Road" in blocklist["brookings_sd"]
    # And the new town is symmetrically protected against Brookings too --
    # not just a one-way addition.
    assert "Brookings" in blocklist["new_town_xy"]


def test_hard_blocklist_is_symmetric_across_every_town_pair():
    from ai_pipeline.town_guard import _build_hard_blocklist
    configs = {
        "a": {"display_name": "Alpha", "state": "SD"},
        "b": {"display_name": "Beta", "state": "CA"},
        "c": {"display_name": "Gamma", "state": "CO"},
    }
    blocklist = _build_hard_blocklist(configs)
    for town_id, terms in blocklist.items():
        for other_id, other_cfg in configs.items():
            if other_id == town_id:
                continue
            assert other_cfg["display_name"] in terms, (
                f"{town_id}'s blocklist is missing {other_id}'s display_name -- "
                "asymmetric coverage, the exact bug this refactor fixed"
            )


def test_county_parenthetical_is_stripped_from_the_derived_term():
    from ai_pipeline.town_guard import _build_hard_blocklist
    configs = {
        "brookings_sd": {"display_name": "Brookings", "state": "SD"},
        "broomfield_co": {"display_name": "Broomfield", "state": "CO",
                           "county": "Broomfield County (consolidated city-county)"},
    }
    blocklist = _build_hard_blocklist(configs)
    assert "Broomfield County" in blocklist["brookings_sd"]
    assert "Broomfield County (consolidated city-county)" not in blocklist["brookings_sd"]


def test_real_configs_on_disk_match_the_derivation():
    # Not a synthetic-configs test -- proves the real configs/*.json this
    # session edited actually produce the intended, backward-compatible
    # term sets (see brookings_sd.json/moreno_valley_ca.json/
    # broomfield_co.json's identity.terms).
    from ai_pipeline.town_guard import HARD_BLOCKLIST
    assert "SDSU" in HARD_BLOCKLIST["moreno_valley_ca"]
    assert "Alessandro" in HARD_BLOCKLIST["broomfield_co"]  # the fixed asymmetric gap
    assert "Interlocken" in HARD_BLOCKLIST["brookings_sd"]


# --- has_local_anchor (3.5 Columns & Editorials, NEEDS-HUMAN-REVIEW.md) ----

def test_local_anchor_blocks_a_placeless_think_piece():
    text = ("Libraries everywhere are adapting to new technology. This is a "
            "trend worth watching as institutions modernize their services "
            "for a new generation of patrons.")
    assert has_local_anchor(text, MORENO_VALLEY_CFG) is False


def test_local_anchor_passes_on_town_name():
    text = "Moreno Valley residents will notice the change starting next month."
    assert has_local_anchor(text, MORENO_VALLEY_CFG) is True


def test_local_anchor_passes_on_street_address():
    text = "The proposal concerns a vacant lot on Frederick Street."
    assert has_local_anchor(text, MORENO_VALLEY_CFG) is True


def test_local_anchor_passes_on_specific_date():
    text = "The commission is scheduled to take up the item on July 23."
    assert has_local_anchor(text, MORENO_VALLEY_CFG) is True


def test_local_anchor_passes_on_named_civic_body():
    text = "The Planning Commission reviewed the application at its last meeting."
    assert has_local_anchor(text, MORENO_VALLEY_CFG) is True
