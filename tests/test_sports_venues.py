"""sports-deep S1 (owner 2026-11-15): register rows, venue_overrides and the venues block in configs/glasgow.json."""
import copy
import json
from datetime import date
from pathlib import Path

import pytest

from sports.config import validate_sports_config
from sports.venues import home_venue, validate_overrides

ROOT = Path(__file__).resolve().parent.parent
GLASGOW = json.loads((ROOT / "configs" / "glasgow.json").read_text(encoding="utf-8"))


def program(pid):
    return next(p for p in GLASGOW["sports"]["programs"] if p["id"] == pid)


# Dates are real Clan home games on clanihc.com/games/fixtures/ (evidence/sports-deep-2026-11/clanihc-fixtures.html, read 2026-11-15):
# "Fri 18 Dec 2026 7:30 pm Glasgow Clan vs Manchester Storm", "Wed 30 Dec 2026 7:30 pm Glasgow Clan vs Belfast Giants",
# "Thu 31 Dec 2026 3:00 pm Glasgow Clan vs Dundee Stars". 2027-01-01/02 test only the span edges (no Clan game those days).
@pytest.mark.parametrize("day,expected", [
    (date(2026, 12, 18), ("Braehead Arena", "config")),
    (date(2026, 12, 26), (None, "unconfirmed")),
    (date(2026, 12, 30), (None, "unconfirmed")),
    (date(2026, 12, 31), ("OVO Hydro", "override")),
    (date(2027, 1, 1), (None, "unconfirmed")),
    (date(2027, 1, 2), ("Braehead Arena", "config")),
])
def test_clan_home_venue_follows_the_override_list(day, expected):
    assert home_venue(program("glasgow-clan"), day) == expected


def test_program_without_home_venue_says_none():
    assert home_venue(program("celtic"), date(2026, 12, 31)) == (None, "none")


def test_real_glasgow_config_validates():
    assert validate_sports_config(GLASGOW) == []


HYDRO = "https://clanihc.com/ice-hockey-at-the-hydro/"


@pytest.mark.parametrize("entries,needle", [
    ([{"date": "2026-12-31", "status": "confirmed", "source_url": HYDRO, "quote": "q"}], "venue: required"),
    ([{"date": "2026-12-31", "status": "confirmed", "venue": "OVO Hydro", "source_url": HYDRO}], "quote: required"),
    ([{"date": "2026-12-31", "status": "unconfirmed", "venue": "OVO Hydro"}], "no venue"),
    ([{"date": "2026-12-31", "status": "maybe"}], "status"),
    ([{"date": "2026-12-31", "from": "2026-12-26", "to": "2027-01-01", "status": "unconfirmed"}], "not both"),
    ([{"from": "2027-01-01", "to": "2026-12-26", "status": "unconfirmed"}], "from is after to"),
    ([{"from": "2026-12-26", "to": "2026-12-31", "status": "unconfirmed"},
      {"from": "2026-12-30", "to": "2027-01-01", "status": "unconfirmed"}], "overlaps"),
    ([{"date": "2026-12-31", "status": "unconfirmed"}, {"date": "2026-12-31", "status": "unconfirmed"}], "already in entry"),
    ([{"date": "31 Dec", "status": "unconfirmed"}], "YYYY-MM-DD"),
    ([{"date": "2026-12-31", "status": "unconfirmed", "venu": "x"}], "unknown key"),
])
def test_bad_override_entries_fail(entries, needle):
    problems = validate_overrides(entries, "x")
    assert any(needle in m for m in problems), problems


def mutated(fn):
    cfg = copy.deepcopy(GLASGOW)
    fn(cfg["sports"])
    return validate_sports_config(cfg)


@pytest.mark.parametrize("fn,needle", [
    (lambda b: b["register"][0].pop("link"), "link: required"),
    (lambda b: b["register"].append({**b["register"][0], "id": "celtic"}), "duplicate"),
    (lambda b: b["register"][0].update(status="maybe"), "status: expected"),
    (lambda b: next(r for r in b["register"] if r["status"] == "awaiting_written_answer").pop("waiting_on"), "waiting_on"),
    (lambda b: b["register"][0].update(group="glasgow"), "group: expected"),
    (lambda b: b["register"][0].update(sport="hockey_field"), "unknown sport"),
    (lambda b: b["register"][0].update(link="http://www.ptfc.co.uk/"), "https"),
    (lambda b: b["programs"][1].update(status="link"), "go in sports.register"),
    (lambda b: b.update(venues={"George Square": {"lat": 55.86, "lon": -4.25}}), "needs exactly"),
    (lambda b: b.update(venues={}, distance_origin="George Square"), "distance_origin"),
    (lambda b: program_in(b, "glasgow-clan")["venue_overrides"][1].pop("quote"), "quote: required"),
])
def test_config_mistakes_fail(fn, needle):
    problems = mutated(fn)
    assert any(needle in m for m in problems), problems


def program_in(block, pid):
    return next(p for p in block["programs"] if p["id"] == pid)


def test_seven_teams_have_a_source_and_the_rest_are_register_rows():
    teams = [p["id"] for p in GLASGOW["sports"]["programs"] if p.get("status") == "source"]
    assert teams == ["celtic", "rangers", "queens-park", "queens-park-women", "glasgow-clan", "gladiators-men", "gladiators-women"]
    around = [r["id"] for r in GLASGOW["sports"]["register"] + GLASGOW["sports"]["programs"] if r.get("group") == "around"]
    assert sorted(around) == ["gladiators-men", "gladiators-women", "west-of-scotland-rugby"]


def test_no_deep_links_to_link_only_bodies():
    # Elite League, SPFL, SLFL, SRU group: home pages only (sports-deep v4 section 4).
    for r in GLASGOW["sports"]["register"] + GLASGOW["sports"]["programs"]:
        link = r.get("link", "")
        for host in ("eliteleague.co.uk", "spfl.co.uk", "slfl.co.uk", "scottishrugby.org", "glasgowwarriors.org", "wosfl.co.uk", "swpl.uk"):
            if host in link:
                assert link.rstrip("/").endswith(host), link


def test_nominatim_is_never_called_by_the_sports_runner_or_the_site():
    # Coordinates are looked up once and kept in config (owner 2026-11-15, answer 8 F15).
    hits = [str(p) for d in ("sports", "site/src") for p in (ROOT / d).rglob("*")
            if p.suffix in (".py", ".ts", ".astro", ".mjs") and "nominatim" in p.read_text(encoding="utf-8", errors="ignore").lower()]
    assert hits == []
