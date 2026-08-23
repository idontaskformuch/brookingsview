"""Regression tests for ai_pipeline/jackrabbits_season_digest.py's pure
logic (grounding-text building, template fallback, content_hash). No DB, no
network -- gather_sport_stats() itself (the only DB-touching function) is
exercised live via --dry-run, same as this project's other digest scripts."""
from ai_pipeline.jackrabbits_season_digest import (
    build_grounding_text, content_hash, template_fallback,
)

STATS_WITH_RANKED_WIN = {
    "sport": "wbb",
    "wins": 28, "losses": 6, "ties": 0,
    "ranked_wins": [
        {"opponent": "#1 Nebraska", "result": "W 78-62", "venue": "Omaha, Neb."},
    ],
    "played_ids": [1, 2, 3],
    "next_game": {
        "opponent": "Gonzaga", "home_away": "neutral",
        "starts_at": None, "venue": "Sioux Falls, S.D.",
    },
}

STATS_NO_RANKED_WIN = {
    "sport": "mbb",
    "wins": 3, "losses": 9, "ties": 0,
    "ranked_wins": [],
    "played_ids": [4, 5, 6],
    "next_game": None,
}


def test_grounding_text_includes_record():
    text = build_grounding_text(STATS_WITH_RANKED_WIN)
    assert "28-6" in text


def test_grounding_text_includes_ranked_win_and_notes_source_scope():
    text = build_grounding_text(STATS_WITH_RANKED_WIN)
    assert "#1 Nebraska" in text
    assert "not SDSU's own ranking" in text


def test_grounding_text_next_game_present():
    text = build_grounding_text(STATS_WITH_RANKED_WIN)
    assert "Gonzaga" in text


def test_grounding_text_no_next_game_says_so():
    text = build_grounding_text(STATS_NO_RANKED_WIN)
    assert "none scheduled" in text


def test_grounding_text_no_ranked_wins_omits_section():
    text = build_grounding_text(STATS_NO_RANKED_WIN)
    assert "WINS OVER RANKED OPPONENTS" not in text


def test_template_fallback_states_record():
    text = template_fallback(STATS_WITH_RANKED_WIN)
    assert "28-6" in text


def test_template_fallback_never_invents_a_moment_with_no_ranked_wins():
    text = template_fallback(STATS_NO_RANKED_WIN)
    assert "Notable win" not in text


def test_content_hash_stable_for_same_played_ids():
    a = content_hash({"played_ids": [3, 1, 2]})
    b = content_hash({"played_ids": [1, 2, 3]})
    assert a == b


def test_content_hash_changes_when_a_game_is_added():
    a = content_hash({"played_ids": [1, 2, 3]})
    b = content_hash({"played_ids": [1, 2, 3, 4]})
    assert a != b
