"""sports-deep S3 (gladiators_fixtures) + S4 (clanihc_fixtures), and the store's keep_known_time. Fixtures are the club pages read once on
2026-11-27 (Clan page 1: 2026-11-15), trimmed to their game cards; every assertion is a real row (rule 15)."""
import json
from pathlib import Path

import pytest

from sports import adapters, store
from sports.adapters.clanihc_fixtures import merge, parse_cards
from sports.adapters.gladiators_fixtures import parse_fixtures
from sports.config import validate_sports_config
from sports.venues import validate_overrides

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).parent / "fixtures" / "sports"
CFG = json.loads((ROOT / "configs" / "glasgow.json").read_text(encoding="utf-8"))
SOURCES = {s["program"]: s for s in CFG["sports"]["sources"]}


def params(program: str) -> dict:
    return adapters.merged_params(SOURCES[program])


def glad(program: str, page: str) -> dict:
    evs = parse_fixtures((FIX / page).read_text(encoding="utf-8"), params(program))
    return {e.source_uid: e for e in evs}


MEN = glad("gladiators-men", "caledoniagladiators_mens-fixtures-2026-11-27.html")
WOMEN = glad("gladiators-women", "caledoniagladiators_womens-fixtures-2026-11-27.html")
CLAN_P1 = (FIX / "clanihc_fixtures-2026-11-15.html").read_text(encoding="utf-8")
CLAN_P2 = (FIX / "clanihc_fixtures-page2-2026-11-27.html").read_text(encoding="utf-8")
CLAN_RES = (FIX / "clanihc_results-2026-11-27.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------- Gladiators

def test_every_game_of_both_pages_comes_through_without_problems():
    assert len(MEN) == 68 and len(WOMEN) == 45  # 69 + 46 fixture-wraps, one unfinished CMS entry ("please-select") on each page
    for e in [*MEN.values(), *WOMEN.values()]:
        assert e.problems() == [] and e.source == "gladiators_fixtures"


def test_upcoming_home_game_4_december_has_the_time_and_no_arena_so_the_site_uses_home_venue():
    e = MEN["gladiators-men:2026-12-04:manchester basketball"]
    assert e.home_program_id == "gladiators-men" and e.away_name == "Manchester Basketball"
    assert e.start_at.isoformat() == "2026-12-04T19:30:00+00:00" and not e.time_tba and e.venue is None and e.status == "scheduled"


def test_away_result_19_november_surrey_is_final_home_score_first_arena_from_the_page_and_keeps_a_known_time():
    e = MEN["gladiators-men:2026-11-19:surrey 89ers"]
    assert (e.home_name, e.away_program_id, e.score_home, e.score_away) == ("Surrey 89ers", "gladiators-men", 85, 86)
    assert e.venue == "Surrey Sports Park" and e.status == "final" and e.time_tba and e.keep_known_time


def test_upcoming_game_with_no_time_on_the_page_is_time_tba_without_keeping_an_old_time():
    e = MEN["gladiators-men:2026-12-02:london lions"]
    assert e.time_tba and not e.keep_known_time and e.venue == "Copper Box Arena" and e.start_at.isoformat() == "2026-12-02T00:00:00+00:00"


def test_an_unfinished_cms_entry_is_not_a_game_but_an_auto_draft_title_with_a_result_is():
    # real wrap: "please-select", "03/04/2026", "Auto Draft", "London Lions", "VS", "Caledonia Gladiators (M)", ...
    assert "gladiators-men:2026-04-03:london lions" not in MEN
    e = WOMEN["gladiators-women:2026-05-10:essex rebels"]  # real wrap: "win", "10/05/2026", "Auto Draft", "80", "Caledonia Gladiators (W)", "VS", "58", ...
    assert (e.home_program_id, e.score_home, e.score_away, e.status) == ("gladiators-women", 80, 58, "final")


def test_women_away_game_in_british_summer_time():
    e = WOMEN["gladiators-women:2027-04-10:b. braun sheffield hatters"]
    assert e.start_at.isoformat() == "2027-04-10T19:00:00+01:00" and e.venue == "Canon Medical Arena" and e.level == "semi-pro"


def test_a_game_without_the_title_heading_is_still_a_game():
    e = WOMEN["gladiators-women:2026-12-06:manchester basketball"]  # real wrap: "06/12/2026", "4:00 pm", "Caledonia Gladiators (W)", "VS", ...
    assert e.home_program_id == "gladiators-women" and e.start_at.isoformat() == "2026-12-06T16:00:00+00:00" and e.venue is None


def test_a_page_without_fixture_wraps_is_an_error_not_an_empty_season():
    with pytest.raises(ValueError):
        parse_fixtures("<html><body><h2>Fixtures</h2></body></html>", params("gladiators-men"))


# ---------------------------------------------------------------- Clan

def clan_all() -> dict:
    p = params("glasgow-clan")
    fixtures = parse_cards(CLAN_P1, p, results=False) + parse_cards(CLAN_P2, p, results=False)
    return {e.source_uid: e for e in merge(fixtures, parse_cards(CLAN_RES, p, results=True))}


def test_three_lists_give_one_row_per_game_without_problems():
    p = params("glasgow-clan")
    assert (len(parse_cards(CLAN_P1, p, False)), len(parse_cards(CLAN_P2, p, False)), len(parse_cards(CLAN_RES, p, True))) == (30, 10, 30)
    rows = clan_all()
    assert len(rows) == 67 and all(e.problems() == [] and e.venue is None for e in rows.values())


def test_page_two_home_game_5_march():
    e = clan_all()["glasgow-clan:2027-03-05:dundee stars"]
    assert e.home_program_id == "glasgow-clan" and e.start_at.isoformat() == "2027-03-05T19:30:00+00:00" and e.status == "scheduled"


def test_a_game_on_both_lists_takes_the_score_from_results_and_the_time_from_fixtures():
    # Wed 25 Nov 2026: fixtures page 1 (15 Nov) "Nov 2026 7:30 pm"; results "Glasgow Clan 4 vs Coventry Blaze 1"
    e = clan_all()["glasgow-clan:2026-11-25:coventry blaze"]
    assert (e.score_home, e.score_away, e.status) == (4, 1, "final")
    assert e.start_at.isoformat() == "2026-11-25T19:30:00+00:00" and not e.time_tba and not e.keep_known_time and e.url == SOURCES["glasgow-clan"]["params"]["results"]


def test_an_away_result_has_the_home_score_first_and_keeps_a_known_time():
    e = clan_all()["glasgow-clan:2026-11-14:fife flyers"]  # results: "Fife Flyers 2 vs Glasgow Clan 4"
    assert (e.home_name, e.score_home, e.score_away, e.status) == ("Fife Flyers", 2, 4, "final") and e.time_tba and e.keep_known_time


def test_a_results_card_without_scores_stays_scheduled():
    e = clan_all()["glasgow-clan:2026-11-20:guildford flames"]  # results: "Fri 20 Nov 2026 Glasgow Clan vs Guildford Flames", no scores
    assert e.status == "scheduled" and e.score_home is None


def test_the_next_game_box_is_never_read():
    # the box on page 1 says "Fri 20th 2026" with no month (spec 1a); alone it gives no card at all
    from bs4 import BeautifulSoup
    box = BeautifulSoup(CLAN_P1, "html.parser").select_one("div.grid.grid-cols-3")
    assert box is not None and "Fri 20th 2026" in CLAN_P1
    with pytest.raises(ValueError):
        parse_cards(str(box), params("glasgow-clan"), results=False)


def test_a_card_whose_weekday_does_not_match_its_date_is_left_out():
    p = params("glasgow-clan")
    changed = CLAN_P2.replace("Fri 5", "Sat 5", 1)  # real card "Fri 5 / Mar 2027 7:30 pm"; only the weekday changed
    assert "glasgow-clan:2027-03-05:dundee stars" not in {e.source_uid for e in parse_cards(changed, p, results=False)}


def test_the_hydro_override_matches_a_fetched_game():
    rows = clan_all()
    assert "glasgow-clan:2026-12-31:dundee stars" in rows
    clan = next(p for p in CFG["sports"]["programs"] if p["id"] == "glasgow-clan")
    assert validate_overrides(clan["venue_overrides"], "glasgow-clan") == []


# ---------------------------------------------------------------- config and store

def test_config_is_valid_with_the_three_new_sources_in_the_spec_priority_order():
    assert validate_sports_config(CFG) == []
    assert CFG["sports"]["source_priority"] == ["sportmonks", "sportspress_calendar", "clanihc_fixtures", "gladiators_fixtures"]
    assert {"gladiators_fixtures", "clanihc_fixtures"} <= set(adapters.names())


def test_keep_known_time_keeps_a_stored_clock_time_on_the_same_local_day_and_only_then():
    keep, plain = store.upsert_sql(True), store.upsert_sql(False)
    assert "start_at=CASE WHEN EXCLUDED.time_tba AND NOT sport_events.time_tba" in keep and "THEN sport_events.start_at" in keep
    assert "time_tba=CASE WHEN" in keep and "AT TIME ZONE" in keep
    assert "start_at=EXCLUDED.start_at" in plain and "CASE" not in plain
