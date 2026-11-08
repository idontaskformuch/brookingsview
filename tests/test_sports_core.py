"""Local sports Phase 0: registry, config schema, adapter registry, dedup, strings, store SQL, check command, migration safety."""
import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from scripts import apply_migration, gen_sports_registry
from sports import adapters, check, dedup, registry, store, strings
from sports.config import validate_sports_config
from sports.models import NormalizedEvent, NormalizedStanding

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def fake_adapter():
    name = "fake_test_adapter"
    adapters._ADAPTERS.pop(name, None)

    @adapters.register(name)
    def fetch(params):
        return [ev(source=name, uid="1", sport=params.get("sport", "soccer"))]

    yield name
    adapters._ADAPTERS.pop(name, None)


def ev(source="ics", uid="1", sport="soccer", opponent="Broomfield High School", day=3, **kw):
    base = dict(source=source, source_uid=uid, sport=sport, level="varsity", gender="boys",
                start_at=datetime(2026, 11, day, 1, 0, tzinfo=timezone.utc), tz="America/Denver", program_id="legacy",
                home_program_id="legacy", away_name=opponent)
    base.update(kw)
    return NormalizedEvent(**base)


def block(**kw):
    b = {"enabled": True, "programs": [{"id": "legacy", "name": "Legacy High School", "colors": ["#1b2a4a", "#c5a253"]},
                                       {"id": "broomfield-hs", "name": "Broomfield High School"}],
         "rivalries": [["legacy", "broomfield-hs"]],
         "sources": [{"adapter": "fake_test_adapter", "program": "legacy", "sport": "soccer", "level": "varsity", "gender": "boys", "url": "https://x.test/cal.ics"}],
         "source_priority": ["manual_verified", "fake_test_adapter", "submissions"], "submissions": {"enabled": True}}
    b.update(kw)
    return {"town_id": "t", "sports": b}


# --- registry -------------------------------------------------------------------------------------------------------------

def test_registry_result_types_and_labels():
    assert registry.result_type("soccer") == "score"
    assert registry.result_type("track") == "placing"
    assert registry.result_type("speedway") == "time"
    assert registry.result_type("equestrian") == "none"
    assert registry.sport_label("soccer", "us") == "Soccer"
    assert registry.sport_label("soccer", "gb") == "Football"


def test_unknown_sport_fails_loudly():
    with pytest.raises(registry.UnknownSportError):
        registry.sport("quidditch")


def test_every_sport_has_valid_result_type_and_unique_id():
    ids = [s["id"] for s in registry._doc()["sports"]]
    assert len(ids) == len(set(ids))
    assert all(s["result_type"] in registry.result_types() for s in registry.sports().values())


def test_ts_mirror_is_current():
    assert gen_sports_registry.main(["--check"]) == 0


# --- config validation ----------------------------------------------------------------------------------------------------

def test_valid_config_has_no_problems(fake_adapter):
    assert validate_sports_config(block()) == []


def test_town_without_sports_block_is_fine():
    assert validate_sports_config({"town_id": "t"}) == []


@pytest.mark.parametrize("mutate,needle", [
    (lambda b: b["sources"][0].update(adapter="nope"), "unknown adapter"),
    (lambda b: b["sources"][0].update(program="ghost"), "unknown program"),
    (lambda b: b["sources"][0].update(sport="quidditch"), "unknown sport"),
    (lambda b: b["sources"][0].update(level="pee-wee"), "unknown level"),
    (lambda b: b["sources"][0].update(typo_key=1), "unknown key"),
    (lambda b: b.update(rivalries=[["legacy", "ghost"]]), "unknown program"),
    (lambda b: b.update(enabeld=True), "unknown key"),
    (lambda b: b.update(source_priority=["manual_verified"]), "missing adapter"),
    (lambda b: b.update(source_priority=["ics_typo", "fake_test_adapter"]), "unknown source"),
    (lambda b: b["programs"][0].update(colors=["red", "blue"]), "colors"),
    (lambda b: b["programs"].append({"id": "legacy", "name": "Dup"}), "duplicate"),
    (lambda b: b.update(nearby_radius_miles=-5), "nearby_radius_miles"),
    (lambda b: b.update(submissions={"enabled": "yes"}), "submissions"),
])
def test_config_typos_fail(fake_adapter, mutate, needle):
    cfg = block()
    mutate(cfg["sports"])
    problems = validate_sports_config(cfg)
    assert any(needle in p for p in problems), problems


def test_all_real_town_configs_validate():
    for path in (ROOT / "configs").glob("*.json"):
        assert validate_sports_config(json.loads(path.read_text(encoding="utf-8"))) == [], path.name


# --- adapters -------------------------------------------------------------------------------------------------------------

def test_adapter_registry_roundtrip(fake_adapter):
    assert fake_adapter in adapters.names()
    assert adapters.get(fake_adapter)({"sport": "hockey"})[0].sport == "hockey"
    with pytest.raises(ValueError):
        adapters.register(fake_adapter)(lambda p: [])
    with pytest.raises(KeyError):
        adapters.get("missing")


def test_merged_params_flattens_params_block():
    src = {"adapter": "mlb_stats", "program": "p", "params": {"team_ids": [1]}}
    assert adapters.merged_params(src) == {"program": "p", "team_ids": [1]}


# --- model ----------------------------------------------------------------------------------------------------------------

def test_event_problems():
    assert ev().problems() == []
    assert any("timezone" in p for p in ev(start_at=datetime(2026, 11, 3)).problems())
    assert any("both a home and an away" in p for p in ev(away_name=None).problems())
    assert any("both be set" in p for p in ev(score_home=3).problems())
    assert ev(sport="track", home_program_id=None, away_name=None, placing_text="3rd of 48").problems() == []
    assert any("unknown sport" in p for p in ev(sport="quidditch").problems())


# --- dedup ----------------------------------------------------------------------------------------------------------------

def test_dedup_keeps_highest_priority_source_across_name_variants():
    a = ev(source="ics", opponent="Broomfield HS")
    b = ev(source="bound", uid="9", opponent="Broomfield High School")
    c = ev(source="ics", uid="2", day=10, opponent="Other")
    kept = dedup.dedup([a, b, c], ["manual_verified", "ics", "bound"])
    assert sorted((e.source, e.source_uid) for e in kept) == [("ics", "1"), ("ics", "2")]
    kept = dedup.dedup([a, b], ["bound", "ics"])
    assert [e.source for e in kept] == ["bound"]


def test_dedup_uses_local_date_not_utc_date():
    late = ev(uid="1", start_at=datetime(2026, 11, 4, 1, 0, tzinfo=timezone.utc))      # Nov 3 18:00 Denver
    early = ev(source="bound", uid="2", start_at=datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc))  # Nov 3 16:00 Denver
    assert len(dedup.dedup([late, early], ["ics", "bound"])) == 1


def test_dedup_separates_sport_level_gender():
    base = ev()
    assert len(dedup.dedup([base, ev(uid="2", gender="girls"), ev(uid="3", level="jv"), ev(uid="4", sport="hockey")], [])) == 4


# --- strings --------------------------------------------------------------------------------------------------------------

def test_country_terms_and_templates():
    assert strings.term("us", "schedule") == "Schedule"
    assert strings.term("gb", "schedule") == "Fixtures"
    assert strings.render("us", "score_final", winner="Legacy", loser="Mountain Range", score="3–1") == "Legacy beat Mountain Range 3–1"
    assert strings.render("gb", "score_line", home="Celtic", hs=2, **{"as": 1}, away="Rangers") == "Celtic 2–1 Rangers"
    assert strings.render("us", "placing", ordinal="3rd", field=48) == "3rd of 48"
    with pytest.raises(KeyError):
        strings.render("us", "score_final", winner="x")


def test_both_countries_define_the_same_keys():
    us, gb = strings.load("us"), strings.load("gb")
    assert us["terms"].keys() == gb["terms"].keys()
    assert us["templates"].keys() == gb["templates"].keys()


# --- store ----------------------------------------------------------------------------------------------------------------

class Cur:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, list(params or [])))


def test_upsert_events_updates_in_place_and_never_deletes():
    cur = Cur()
    assert store.upsert_events(cur, "t", [ev(), ev(uid="2")]) == 2
    sql, params = cur.calls[0]
    assert "ON CONFLICT (town_id, source, source_uid) DO UPDATE" in sql and "first_seen" not in sql.split("DO UPDATE")[1]
    assert "DELETE" not in sql.upper()
    assert params[:3] == ["t", "ics", "1"] and params[3 + store._EVENT_COLS.index("result_type")] == "score"  # result_type comes from the registry, not the adapter


def test_upsert_events_refuses_invalid_event():
    with pytest.raises(ValueError):
        store.upsert_events(Cur(), "t", [ev(sport="quidditch")])


def test_sync_programs_mirrors_rivalries_both_ways():
    cur = Cur()
    store.sync_programs(cur, "t", block()["sports"])
    rivals = {p[1]: p[-1] for _, p in cur.calls}
    assert rivals == {"legacy": ["broomfield-hs"], "broomfield-hs": ["legacy"]}


def test_record_health_success_and_error():
    cur = Cur()
    store.record_health(cur, "t", "ics:legacy", event_count=12)
    store.record_health(cur, "t", "ics:legacy", error="x" * 900)
    assert cur.calls[0][1][3] == 12 and len(cur.calls[1][1][2]) == 500


# --- check command --------------------------------------------------------------------------------------------------------

def test_check_reports_counts_range_and_sports(fake_adapter):
    get = lambda url, ua: (404, "")
    problems, reports = check.check_town(block(), get=get, sleep=lambda s: None)
    assert problems == []
    r = reports[0]
    assert (r.reachable, r.robots_ok, r.events, r.sports) == (True, True, 1, ["soccer"])
    assert r.first == r.last == "2026-11-03"
    assert "events=1" in r.line() and "robots=ok" in r.line()


def test_check_skips_adapter_when_robots_blocks(fake_adapter):
    called = []
    adapters._ADAPTERS[fake_adapter] = lambda p: called.append(1) or []
    for status in (403, None):
        problems, reports = check.check_town(block(), get=lambda url, ua: (status, "blocked"), sleep=lambda s: None)
        assert reports[0].robots_ok is False and reports[0].error and not called


def test_check_skips_source_whose_crawl_delay_is_above_the_limit(fake_adapter):
    called, slept = [], []
    adapters._ADAPTERS[fake_adapter] = lambda p: called.append(1) or []
    robots = "User-agent: *\nCrawl-delay: 90\nDisallow: /private\n"
    _, reports = check.check_town(block(), get=lambda url, ua: (200, robots), sleep=slept.append)
    r = reports[0]
    assert not called and not slept                      # no fetch at all, certainly no faster one
    assert r.robots_ok is True and r.crawl_delay == 90 and "max_crawl_delay" in r.error
    assert check.crawl_delay("User-agent: bot\nCrawl-delay: 5\nUser-agent: *\nCrawl-delay: 2") == 2.0
    assert check.crawl_delay("User-agent: *\nDisallow:") is None


def test_max_crawl_delay_is_validated(fake_adapter):
    cfg = block()
    cfg["sports"]["sources"][0]["max_crawl_delay"] = 120
    assert validate_sports_config(cfg) == []
    for bad in (0, -1, "60", True):
        cfg["sports"]["sources"][0]["max_crawl_delay"] = bad
        assert any("max_crawl_delay" in m for m in validate_sports_config(cfg))


def test_check_reports_adapter_failure_without_stopping(fake_adapter):
    adapters._ADAPTERS[fake_adapter] = lambda p: (_ for _ in ()).throw(RuntimeError("boom"))
    _, reports = check.check_town(block(), get=lambda u, a: (404, ""), sleep=lambda s: None)
    assert reports[0].error.startswith("RuntimeError") and not reports[0].reachable


def test_check_stops_on_invalid_config():
    problems, reports = check.check_town(block(sources=[{"adapter": "nope"}]))
    assert problems and reports == []


def test_validate_all_passes_on_real_configs(capsys):
    assert check.main(["--validate-all"]) == 0


def test_standing_dataclass_defaults():
    s = NormalizedStanding(source="x", competition="c", season="2026", team_name="Legacy", as_of=date(2026, 11, 3))
    assert s.rank is None


# --- migration ------------------------------------------------------------------------------------------------------------

def test_sports_migration_is_additive_and_creates_the_four_tables():
    sql = (ROOT / "db" / "migrations" / "066_local_sports.sql").read_text(encoding="utf-8")
    assert apply_migration.check_additive(sql) == []
    for table in ("sport_programs", "sport_events", "sport_standings", "sport_sources_health"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    assert "town_id" in sql


@pytest.mark.parametrize("stmt", ["DROP TABLE x", "ALTER TABLE x ADD COLUMN y int", "DELETE FROM x", "UPDATE x SET a=1", "INSERT INTO x VALUES (1)"])
def test_apply_migration_refuses_non_additive(stmt):
    assert apply_migration.check_additive(stmt + ";")


def test_robots_mode_is_validated(fake_adapter):
    cfg = block()
    cfg["sports"]["sources"][0]["robots_mode"] = "strict"
    assert validate_sports_config(cfg) == []
    cfg["sports"]["sources"][0]["robots_mode"] = "loose"
    assert any("robots_mode" in m for m in validate_sports_config(cfg))


def test_flags_migration_is_additive_and_adds_both_columns():
    sql = (ROOT / "db" / "migrations" / "067_sport_events_flags.sql").read_text(encoding="utf-8")
    assert apply_migration.check_additive(sql) == []
    assert "ADD COLUMN IF NOT EXISTS time_tba boolean NOT NULL DEFAULT false" in sql
    assert "ADD COLUMN IF NOT EXISTS neutral_site boolean NOT NULL DEFAULT false" in sql
    assert len(apply_migration.statements(sql)) == 2


@pytest.mark.parametrize("stmt", [
    "ALTER TABLE x DROP COLUMN y", "ALTER TABLE x ADD COLUMN IF NOT EXISTS y int REFERENCES z(id)",
    "ALTER TABLE x ADD COLUMN IF NOT EXISTS y boolean; DROP TABLE x", "ALTER TABLE x RENAME COLUMN a TO b",
    "ALTER TABLE x ALTER COLUMN a TYPE text", "ALTER TABLE x ADD COLUMN IF NOT EXISTS y text DEFAULT (select 1)",
])
def test_add_column_allowance_is_narrow(stmt):
    assert apply_migration.check_additive(stmt + ";")


def test_store_writes_the_two_flags():
    assert "time_tba" in store._EVENT_COLS and "neutral_site" in store._EVENT_COLS
    cur = Cur()
    store.upsert_events(cur, "t", [ev(time_tba=True, neutral_site=True)])
    sql, params = cur.calls[0]
    assert "time_tba" in sql and "neutral_site" in sql and params[-3:] == [True, True, False]


def test_tba_and_neutral_strings_exist_in_both_countries():
    assert strings.term("us", "time_tba") == strings.term("gb", "time_tba") == "TBA"
    assert strings.term("us", "neutral_site") == "Neutral site"


def test_exhibition_migration_is_additive_and_store_writes_the_flag():
    sql = (ROOT / "db" / "migrations" / "068_sport_events_exhibition.sql").read_text(encoding="utf-8")
    assert apply_migration.check_additive(sql) == []
    assert len(apply_migration.statements(sql)) == 1 and "exhibition boolean NOT NULL DEFAULT false" in sql
    cur = Cur()
    store.upsert_events(cur, "t", [ev(exhibition=True)])
    assert "exhibition" in cur.calls[0][0] and cur.calls[0][1][-1] is True


def test_duration_hours_per_sport_with_a_default_of_four():
    from sports import registry
    assert registry.duration_hours("football") == 3.5 and registry.duration_hours("basketball") == 2.5
    assert registry.duration_hours("golf") == 4
    assert all(isinstance(s.get("typical_duration_hours", 4), (int, float)) and 0 < s.get("typical_duration_hours", 4) <= 12
               for s in registry.sports().values())
