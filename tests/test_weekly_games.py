"""The weekly roundup reads games from sport_events (sport_events): our side, result line, neutral/exhibition/TBA wording."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ai_pipeline import weekly

TZ = ZoneInfo("America/Chicago")


def row(**o):
    base = dict(id=1, sport="basketball", gender="men", program_id="sdsu", starts_at=datetime(2026, 11, 12, 1, 0, tzinfo=timezone.utc),
                venue="Brookings, S.D.", status="scheduled", time_tba=False, neutral_site=False, exhibition=False,
                home_program_id="sdsu", home_name=None, away_program_id=None, away_name="Opp", score_home=None, score_away=None)
    base.update(o)
    return base


def test_sides_and_team_keys():
    assert weekly._game(row())["home_away"] == "home"
    away = weekly._game(row(gender="women", home_program_id=None, home_name="Texas", away_program_id="sdsu", away_name=None))
    assert (away["home_away"], away["sport"], away["opponent"]) == ("away", "wbb", "Texas")
    assert weekly._game(row(neutral_site=True))["home_away"] == "neutral"
    assert weekly._game(row(sport="football"))["sport"] == "football"


def test_result_line_is_from_our_side_and_only_for_final():
    assert weekly._game(row(status="final", score_home=91, score_away=62))["result"] == "W 91-62"
    lost = weekly._game(row(status="final", home_program_id=None, home_name="Omaha", away_program_id="sdsu", away_name=None, score_home=70, score_away=60))
    assert lost["result"] == "L 60-70"
    assert weekly._game(row(score_home=1, score_away=0))["result"] is None


def test_source_text_marks_exhibition_neutral_and_unannounced_time():
    games = [weekly._game(row(id=1, exhibition=True, status="final", score_home=91, score_away=62)),
             weekly._game(row(id=2, neutral_site=True, time_tba=True, starts_at=datetime(2026, 11, 22, 6, 0, tzinfo=timezone.utc)))]
    text = weekly.source_text({"meetings": [], "events": [], "games": games}, "week", TZ)
    assert "exhibition, not counted in the record" in text and "Result: W 91-62." in text
    assert "at a neutral site" in text and "time to be announced" in text
    assert "12:00 AM" not in text
