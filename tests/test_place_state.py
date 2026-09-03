"""Regression tests for validation/place_state.py (Phase 0 check 2)."""
from validation.place_state import check_place_state

BROOKINGS_CFG = {"display_name": "Brookings", "state": "SD"}
MORENO_VALLEY_CFG = {"display_name": "Moreno Valley", "state": "CA"}


def test_passes_with_no_state_mentioned():
    result = check_place_state("The council approved the budget Tuesday.", None, BROOKINGS_CFG)
    assert result.passed


def test_passes_when_the_mentioned_state_is_the_active_towns_own():
    result = check_place_state("Brookings, South Dakota, approved the plan.", None, BROOKINGS_CFG)
    assert result.passed


def test_fails_on_a_fabricated_out_of_state_place_not_in_source():
    text = "The event will be held in Austin, Texas, according to organizers."
    result = check_place_state(text, {"title": "Fall Festival", "location": "Main Avenue"}, BROOKINGS_CFG)
    assert not result.passed
    assert any("Texas" in v for v in result.violations)


def test_passes_when_the_out_of_state_place_is_genuinely_sourced():
    # A real, sourced fact -- must not be treated the same as a fabrication
    # just because it names a state other than the active town's own.
    text = "The event will be held in Austin, Texas, according to organizers."
    result = check_place_state(text, {"location": "Austin, Texas convention center"}, BROOKINGS_CFG)
    assert result.passed


# --- sports/university false-positive guard --------------------------------
# "Must not misfire on legitimate out-of-state references in sports and
# university content... assert the existing behavior in tests before
# changing it." -- handoff. Fixture shaped like ai_pipeline/
# sports_weekly_digest.py's real record (opponent_name/home_away/game_date),
# a genuine away game against an out-of-state opponent.

def test_does_not_misfire_on_a_real_away_game_opponent():
    away_game_record = {
        "team_name": "SDSU Jackrabbits", "league": "NCAA FB",
        "opponent_name": "University of Northern Iowa", "home_away": "away",
        "team_score": 24, "opponent_score": 17, "game_date": "2026-09-06",
        "status": "final",
    }
    text = "The Jackrabbits beat Northern Iowa 24-17 on the road in Iowa Saturday."
    result = check_place_state(text, away_game_record, BROOKINGS_CFG)
    assert result.passed


def test_does_not_misfire_on_a_visiting_teams_home_state_named_in_university_events():
    # SDSU athletics/events content naming a visiting team's home state --
    # ai_pipeline/sdsu_weekly_digest.py's record shape (title/location/teaser).
    event_record = {
        "title": "Volleyball vs. University of Nebraska",
        "location": "Frost Arena", "teaser": "SDSU hosts Nebraska in a nonconference match.",
    }
    text = "SDSU hosts Nebraska, a team built around a strong Lincoln recruiting base, Friday."
    result = check_place_state(text, event_record, BROOKINGS_CFG)
    assert result.passed


# --- companion to ai_pipeline/town_guard.py's state-name removal -----------
# tests/test_town_guard.py removed "South Dakota" as a check-1 (wrong-town
# leakage) hit for this exact real contaminated fixture, since check 1 no
# longer hard-blocks bare state names (see that file's own comment on why).
# This proves check 2 picks up the slack, correctly grounded: the real
# contaminated text names South Dakota, and it is NOT present anywhere in
# Moreno Valley's actual (unrelated) source data, so it still fails, via the
# check actually suited to arbitrating state-level claims.

def test_moreno_valley_state_leakage_is_still_caught_by_place_state():
    contaminated_text = (
        "Here in Brookings, South Dakota, SDSU's Barn Owl Blast Marching "
        "Festival returns to campus this weekend, with bands traveling in "
        "from as far as Volga and Elkton along Highway 14."
    )
    real_source_record = {"title": "Library summer reading program",
                           "location": "Iris Plaza branch"}
    result = check_place_state(contaminated_text, real_source_record, MORENO_VALLEY_CFG)
    assert not result.passed
    assert any("South Dakota" in v for v in result.violations)
