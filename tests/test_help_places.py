"""/help/ step 1a (owner 2026-11-27, spec .claude/specs/help-resources.md): the data model on places, its visibility rules and the
write path. Fixture values are verbatim from the operator pages fetched 2026-11-27 (ledger .claude/fetch-ledger/2026-11-27.jsonl):
brookingscountyfoodpantry.weebly.com and feedingbrookings.org (CLAUDE.md rule 15). Where a test changes one field of such a row to
reach an edge case, the comment names the field."""
from __future__ import annotations

import re
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

from db import help_places as hp
from scripts.apply_migration import MIGRATIONS, check_additive, statements

ROOT = Path(__file__).resolve().parent.parent
TODAY = date(2026, 11, 27)

# Brookings County Food Pantry, https://brookingscountyfoodpantry.weebly.com/ (fetched 2026-11-27)
PANTRY_PAGE = (
    "To receive emergency food assistance please bring the following with you:\n1.\nProof of your physical address (\n"
    "Ex: Current utility or gas bill, lease/rental agreement, or letter of acceptance for public assistance\n2.\n"
    "Current picture identification.\nThe Brookings County Food Pantry, now located at\n908 Hope Drive, is open for Public Assistance\n"
    "Monday - Wednesday - Friday\n1:00 p.m. - 4:30 p.m.\nBrookings Food Pantry Mission: The primary objects and purposes of the "
    "Brookings County Food Pantry shall be to help solve EMERGENCY food needs of Brookings County families by providing them with "
    "surplus or salvaged food"
)
# 1b: postal_code dropped (57006 is on neither page; a postal code is now checked like the street) and town_evidence added.
PANTRY = hp.HelpEntry(
    town_id="brookings_sd", slug="brookings-county-food-pantry", name="Brookings County Food Pantry", category="food_pantry",
    source_url="https://brookingscountyfoodpantry.weebly.com/", source_kind="operator",
    street_address="908 Hope Drive", phone="605-692-5007",
    requirements_note="Photo ID; Proof of address",
    requirements_evidence="Current picture identification\nProof of your physical address",
    audience_tags=("everyone",), town_evidence="EMERGENCY food needs of Brookings County families",
)
# Feeding Brookings, https://www.feedingbrookings.org/ (fetched 2026-11-27)
FEEDING = hp.HelpEntry(
    town_id="brookings_sd", slug="feeding-brookings", name="Feeding Brookings", category="food_pantry",
    source_url="https://www.feedingbrookings.org/", source_kind="operator",
    street_address="2030 3rd St.", requirements_note="No residency requirement",
    requirements_evidence="There is no residency requirement",
    audience_tags=("everyone",), town_evidence="Ascension Lutheran Church in Brookings, SD",
)
FEEDING_PAGE = ("There is no residency requirement. Where are we?\nAscension Lutheran Church in Brookings. 2030 3rd St.\n"
                "If you can use a box, drive up to Ascension Lutheran Church in Brookings, SD any Thursday 3-5pm.")


# --- categories and their mirrors ----------------------------------------------------------------------------------------------

def test_categories_and_which_are_on_in_step_1():
    assert hp.HELP_CATEGORIES == ("food_pantry", "meal_program", "warm_space", "assistance_program", "free_clinic")
    assert hp.ENABLED_CATEGORIES == frozenset({"food_pantry", "meal_program", "warm_space"})
    assert hp.HELP_ROLES == ("warm_space",)  # owner decision 2: a warm space on an existing place is a role in services


def _ts_list(path: Path, name: str) -> set[str]:
    m = re.search(rf"{name}[^=]*=\s*(?:new Set\()?\[([^\]]*)\]", path.read_text(encoding="utf-8"))
    assert m, f"{name} not found in {path}"
    return set(re.findall(r"'([^']+)'", m.group(1)))


def test_site_mirrors_the_same_categories():
    want = set(hp.HELP_CATEGORIES)
    assert _ts_list(ROOT / "site/src/lib/db.ts", "HELP_CATEGORIES") == want
    assert _ts_list(ROOT / "site/astro.config.mjs", "HELP_CATEGORIES") == want


def test_venue_registry_never_resolves_an_event_to_a_help_place():
    """An event at Ascension Lutheran must not link to /facilities/feeding-brookings/: help places have no detail page (decision 4)."""
    from ai_pipeline import venue_registry

    class Cur:
        def __init__(self):
            self.sql, self.params = "", ()

        def execute(self, sql, params=()):
            self.sql, self.params = sql, params

        def fetchall(self):
            return []

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    cur = Cur()

    class Conn:
        def cursor(self):
            return cur

    venue_registry.load_registry(Conn(), "brookings_sd")
    assert "category <> ALL" in cur.sql
    assert list(hp.HELP_CATEGORIES) in [p for p in cur.params if isinstance(p, list)]


# --- migration ----------------------------------------------------------------------------------------------------------------

def _migration() -> str:
    return next(MIGRATIONS.glob("077_*.sql")).read_text(encoding="utf-8")


def test_migration_077_is_additive_and_passes_apply_migration():
    assert check_additive(_migration()) == []


@pytest.mark.parametrize("col", ["source_kind", "verification_status", "requirements_note", "area_name", "valid_from", "valid_to",
                                 "audience_tags", "schedule_rule"])
def test_migration_adds_each_place_column(col):
    assert any(re.match(rf"(?i)alter table places add column if not exists {col}\b", s) for s in statements(_migration()))


def test_migration_creates_place_roles_with_its_own_dates():
    create = next(s for s in statements(_migration()) if s.lower().startswith("create table if not exists place_roles"))
    for col in ("place_id", "role", "valid_from", "valid_to", "source_url", "source_kind", "verification_status", "verified_date"):
        assert re.search(rf"\b{col}\b", create)
    assert "unique (place_id, role)" in create.lower()


# --- validation: never a guessed field ---------------------------------------------------------------------------------------

def test_real_rows_validate_against_their_own_page():
    assert hp.validate(PANTRY, PANTRY_PAGE) == []
    assert hp.validate(FEEDING, FEEDING_PAGE) == []


def test_requirement_evidence_not_on_the_page_is_refused():
    # Feeding Brookings with requirements_evidence changed to a line its page does not carry
    bad = replace(FEEDING, requirements_evidence="Photo ID required")
    assert any("requirements_evidence" in p for p in hp.validate(bad, FEEDING_PAGE))


def test_requirement_label_must_be_on_the_list_and_match_its_evidence():
    # Feeding Brookings with requirements_note changed to a label outside the list
    assert any("not a requirement label" in p
               for p in hp.validate(replace(FEEDING, requirements_note="There is no residency requirement"), FEEDING_PAGE))
    # Feeding Brookings with requirements_note changed to a listed label its evidence does not say
    assert any("Photo ID" in p for p in hp.validate(replace(FEEDING, requirements_note="Photo ID"), FEEDING_PAGE))
    # a label without evidence
    assert any("evidence" in p for p in hp.validate(replace(FEEDING, requirements_evidence=None), FEEDING_PAGE))


def test_location_note_must_be_on_the_page():
    assert hp.validate(replace(FEEDING, location_note="Ascension Lutheran Church"), FEEDING_PAGE) == []
    # location_note changed to a building the page does not name
    assert any("location_note" in p for p in hp.validate(replace(FEEDING, location_note="VFW building"), FEEDING_PAGE))


def test_migration_078_adds_location_note_and_requirements_evidence():
    sql = next(MIGRATIONS.glob("078_*.sql")).read_text(encoding="utf-8")
    assert check_additive(sql) == []
    for col in ("location_note", "requirements_evidence"):
        assert any(re.match(rf"(?i)alter table places add column if not exists {col}\b", s) for s in statements(sql))
    assert {"location_note", "requirements_evidence"} <= set(hp._COLUMNS)


def test_street_address_not_on_the_page_is_refused():
    # Brookings County Food Pantry with street_address changed
    bad = replace(PANTRY, street_address="908 Hope Dr")
    assert any("street_address" in p for p in hp.validate(bad, PANTRY_PAGE))


@pytest.mark.parametrize("field,value,needle", [
    ("source_url", "", "source_url"),
    ("source_kind", "aggregator", "source_kind"),
    ("category", "free_clinic", "category"),       # defined, not enabled
    ("category", "library", "category"),           # not a help category
    ("audience_tags", ("kids",), "audience_tags"),
    ("requirements_note", "x" * 161, "requirements_note"),
])
def test_field_rules(field, value, needle):
    # Brookings County Food Pantry with the one field named in the parameters changed
    assert any(needle in p for p in hp.validate(replace(PANTRY, **{field: value}), PANTRY_PAGE))


def test_seasonal_dates_must_be_in_order():
    # Brookings County Food Pantry with valid_from/valid_to set (it has none)
    assert any("valid_" in p for p in hp.validate(replace(PANTRY, valid_from=date(2026, 12, 1), valid_to=date(2026, 11, 1)), PANTRY_PAGE))


# --- publish / queue / reject -----------------------------------------------------------------------------------------------

def test_operator_and_official_publish_other_queues_and_problems_reject():
    assert hp.publish_decision(PANTRY, PANTRY_PAGE) == ("publish", "")
    # source_kind changed to 'other'
    assert hp.publish_decision(replace(PANTRY, source_kind="other"), PANTRY_PAGE)[0] == "queue"
    # street_address changed
    decision, why = hp.publish_decision(replace(PANTRY, street_address="1 Main St"), PANTRY_PAGE)
    assert decision == "reject" and "street_address" in why


# --- visibility: age, status, season ----------------------------------------------------------------------------------------

def _row(**kw):
    base = dict(category="food_pantry", source_kind="operator", verification_status="verified", verified_date=TODAY,
                valid_from=None, valid_to=None)
    base.update(kw)
    return base


def test_verified_within_max_age_is_visible_and_hidden_after():
    assert hp.is_visible(_row(verified_date=date(2026, 10, 13)), TODAY)        # 45 days
    assert not hp.is_visible(_row(verified_date=date(2026, 10, 12)), TODAY)    # 46 days
    assert not hp.is_visible(_row(verified_date=None), TODAY)


@pytest.mark.parametrize("status", ["changed", "stale", "gone", None])
def test_only_verified_is_visible(status):
    assert not hp.is_visible(_row(verification_status=status), TODAY)


def test_other_source_never_visible_and_disabled_category_never_visible():
    assert not hp.is_visible(_row(source_kind="other"), TODAY)
    assert not hp.is_visible(_row(category="free_clinic"), TODAY)
    assert not hp.is_visible(_row(category="assistance_program"), TODAY)


def test_seasonal_entry_expires_the_day_after_valid_to():
    assert hp.is_visible(_row(valid_to=TODAY), TODAY)
    assert not hp.is_visible(_row(valid_to=date(2026, 11, 26)), TODAY)
    assert not hp.is_visible(_row(valid_from=date(2026, 11, 28)), TODAY)
    assert hp.is_visible(_row(valid_from=TODAY), TODAY)


def test_role_on_an_existing_place_uses_the_roles_own_dates():
    role = dict(role="warm_space", source_kind="official", verification_status="verified", verified_date=TODAY,
                valid_from=date(2026, 11, 1), valid_to=date(2027, 3, 31))
    assert hp.role_active(["warm_space"], role, TODAY)
    assert not hp.role_active([], role, TODAY)                                   # not in services: no role
    assert not hp.role_active(["warm_space"], {**role, "valid_to": date(2026, 11, 26)}, TODAY)
    assert not hp.role_active(["warm_space"], {**role, "verification_status": "changed"}, TODAY)
    assert not hp.role_active(["warm_space"], None, TODAY)                       # no dates row: never shown


def test_min_entries_omits_the_page():
    assert hp.MIN_ENTRIES == 6
    assert not hp.page_has_enough(5)
    assert hp.page_has_enough(6)


# --- write path -------------------------------------------------------------------------------------------------------------

class RecCur:
    def __init__(self, existing=None):
        self.calls, self.existing = [], existing

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.existing


def test_insert_writes_every_help_field_and_a_stable_content_hash():
    cur = RecCur(existing=None)
    action = hp.write_entry(cur, PANTRY, TODAY)
    assert action == "insert"
    sql, params = cur.calls[-1]
    assert sql.startswith("INSERT INTO places")
    for col in ("source_kind", "verification_status", "requirements_note", "audience_tags", "verified_date", "content_hash",
                "location_note", "requirements_evidence"):
        assert col in sql
    assert "help-brookings-county-food-pantry" in params
    assert "verified" in params and TODAY in params
    assert "Photo ID; Proof of address" in params   # the labels the card shows
    assert "Current picture identification\nProof of your physical address" in params   # the evidence, kept


def test_update_never_touches_a_non_help_place():
    cur = RecCur(existing=(7, "library"))
    with pytest.raises(ValueError, match="not a help place"):
        hp.write_entry(cur, PANTRY, TODAY)


def test_update_of_an_existing_help_place():
    cur = RecCur(existing=(7, "food_pantry"))
    assert hp.write_entry(cur, PANTRY, TODAY) == "update"
    sql, params = cur.calls[-1]
    assert sql.startswith("UPDATE places SET") and params[-1] == 7


def test_queued_entry_is_written_hidden():
    # 1c (owner 2026-11-27): a queued row is stored but never visible -- verification_status 'queued', not 'verified'.
    cur = RecCur(existing=None)
    hp.write_entry(cur, PANTRY, TODAY, status="queued")
    _, params = cur.calls[-1]
    assert "queued" in params and "verified" not in params
    with pytest.raises(ValueError):
        hp.write_entry(RecCur(), PANTRY, TODAY, status="published")


def test_schedule_replaces_rows_of_the_place_and_stores_dates_as_one_day_rows():
    cur = RecCur()
    n = hp.write_schedule(cur, 42, weekly=[(1, "13:00", "16:30")], dates=[(date(2026, 12, 1), None, None)],
                          closed=[(date(2026, 11, 26), "Thanksgiving"), (date(2026, 12, 25), "Christmas")],
                          source_url="https://x", today=TODAY)
    sqls = [s for s, _ in cur.calls]
    assert sqls[0].startswith("DELETE FROM place_hours WHERE place_id") and sqls[1].startswith("DELETE FROM place_hours_exceptions")
    hours = [p for s, p in cur.calls if s.startswith("INSERT INTO place_hours ")]
    assert hours == [(42, 1, "13:00", "16:30", None, None), (42, 2, None, None, date(2026, 12, 1), date(2026, 12, 1))]   # Tue Dec 1
    exc = [p for s, p in cur.calls if s.startswith("INSERT INTO place_hours_exceptions")]
    assert [p[1] for p in exc] == [date(2026, 12, 25)]   # a passed closure is not written
    assert n == (2, 1)


def test_queued_role_never_touches_the_venue_services():
    cur = RecCur()
    hp.write_role(cur, 9, "warm_space", PANTRY, TODAY, status="queued", schedule_text="Mon 9-5")
    sqls = [s for s, _ in cur.calls]
    assert len(sqls) == 1 and sqls[0].startswith("INSERT INTO place_roles") and "ON CONFLICT (place_id, role)" in sqls[0]
    assert "queued" in cur.calls[0][1]
    cur = RecCur()
    hp.write_role(cur, 9, "warm_space", PANTRY, TODAY, status="verified")
    assert any(s.startswith("UPDATE places SET services") for s, _ in cur.calls)


# --- 1b: the town rule (owner 2026-11-27). Phrases verbatim from the pages fetched 2026-11-27 (tests/fixtures/help_sources_2026-11-27/).
@pytest.mark.parametrize("town, phrase, kind", [
    ("broomfield_co", "6900 W. 117th Ave, #700W Broomfield, CO 80020", "locality"),          # north_denver_cares.html
    ("glasgow", "Ibrox Parish Church 67 Clifford Street Glasgow G51 1QH", "locality"),         # glasgowsw_locations.html
    ("glasgow", "209-211 Main Street Glasgow Bridgeton G40 1QH", "locality"),                  # glasgowne_locations.html (The Story Coffee)
    ("brookings_sd", "Brookings, SD 57007", "locality"),                                       # jacks_cupboard.html
    ("moreno_valley_ca", "The pantries below serve residents across Moreno Valley.", "serves"),  # moval_food_pantries.html
    ("brookings_sd", "EMERGENCY food needs of Brookings County families", "serves"),           # brookings_county_food_pantry.html
])
def test_town_rule_accepts_a_locality_or_a_serving_statement(town, phrase, kind):
    assert hp.town_kind(town, phrase) == kind


@pytest.mark.parametrize("town, phrase", [
    ("broomfield_co", "Northglenn, CO 80234"),   # Good Shepherd's own locality (Phase 0 report), rejected: another town
    ("brookings_sd", "Feeding Brookings"),                      # the operator's name is not a place
    ("broomfield_co", "Broomfield FISH"),
    ("glasgow", "Glasgow SW Foodbank"),
    ("moreno_valley_ca", "Moreno Valley Conference & Recreation Center"),
])
def test_town_rule_refuses_a_name_without_locality_or_service(town, phrase):
    assert hp.town_kind(town, phrase) is None


def test_a_row_without_town_evidence_is_rejected_with_the_rule_as_reason():
    decision, why = hp.publish_decision(replace(FEEDING, town_evidence=None), FEEDING_PAGE)
    assert decision == "reject" and "neither gives Brookings as the locality nor says it serves it" in why


def test_town_evidence_must_be_on_the_page():
    # FEEDING with the one field town_evidence changed to a phrase that is not on feedingbrookings.org
    assert any("town:" in p for p in hp.validate(replace(FEEDING, town_evidence="Brookings, SD 57006"), FEEDING_PAGE))


def test_postal_code_must_be_on_the_page():
    # PANTRY with the one field postal_code set: 57006 is not on brookingscountyfoodpantry.weebly.com
    assert any("postal_code" in p for p in hp.validate(replace(PANTRY, postal_code="57006"), PANTRY_PAGE))


def test_review_reason_queues_a_valid_row():
    assert hp.publish_decision(PANTRY, PANTRY_PAGE, review="two seasonal schedules") == ("queue", "two seasonal schedules")
