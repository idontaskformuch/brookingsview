"""scripts/apply_migration.py whitelist (owner 2026-11-13, proposal 5): 071 had to be run around the check because it refused
BIGINT REFERENCES, SMALLINT[] and DATE. Those pass now; anything that changes or validates existing rows is still refused."""
import pytest

from scripts.apply_migration import MIGRATIONS, check_additive, statements

_071 = (MIGRATIONS / "071_evening_register_place_link.sql") if (MIGRATIONS / "071_evening_register_place_link.sql").is_file() \
    else next(MIGRATIONS.glob("071_*.sql"))


def test_071s_three_lines_pass_verbatim():
    sql = _071.read_text(encoding="utf-8")
    assert len(statements(sql)) == 3
    assert check_additive(sql) == []


@pytest.mark.parametrize("stmt", [
    "ALTER TABLE evening_register_venues ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places (id)",
    "ALTER TABLE evening_register_entries ADD COLUMN IF NOT EXISTS weeks_of_month SMALLINT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE evening_register_entries ADD COLUMN IF NOT EXISTS valid_until DATE",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS lat2 NUMERIC(9,6)",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS flag BOOLEAN DEFAULT false NOT NULL",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS n INTEGER",
])
def test_additive_columns_pass(stmt):
    assert check_additive(stmt) == []


@pytest.mark.parametrize("stmt", [
    "ALTER TABLE places DROP COLUMN extra",
    "ALTER TABLE places ALTER COLUMN extra TYPE text",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS n INTEGER CHECK (n > 0)",
    "ALTER TABLE evening_register_venues ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places (id) ON DELETE CASCADE",
    "ALTER TABLE evening_register_venues ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places (id) ON DELETE SET NULL",
    "ALTER TABLE evening_register_entries ADD COLUMN IF NOT EXISTS valid_until DATE NOT NULL",
    "ALTER TABLE places ADD COLUMN extra JSONB",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS v VARCHAR(10)",
    "UPDATE places SET extra = '{}'",
    "DELETE FROM places",
])
def test_changes_to_existing_rows_are_refused(stmt):
    assert check_additive(stmt) != []


# Widening a CHECK IN list (owner 2026-11-16, 072). LIVE is verbatim pg_get_constraintdef for sport_events on 2026-11-16.
LIVE = {
    "sport_events_level_check": ("sport_events", "CHECK ((level = ANY (ARRAY['pro'::text, 'minor'::text, 'college'::text, 'varsity'::text, 'jv'::text, 'amateur'::text, 'youth'::text])))"),
    "sport_events_status_check": ("sport_events", "CHECK ((status = ANY (ARRAY['scheduled'::text, 'final'::text, 'postponed'::text, 'cancelled'::text])))"),
}
DROP = "ALTER TABLE sport_events DROP CONSTRAINT sport_events_level_check;\n"
WIDER = "('pro','minor','semi-pro','college','varsity','jv','amateur','youth')"


def test_widening_pair_passes():
    assert check_additive(DROP + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})", LIVE) == []


@pytest.mark.parametrize("sql", [
    # another constraint name in the ADD
    DROP + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check2 CHECK (level IN {WIDER})",
    # a value removed ('youth')
    DROP + "ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN ('pro','minor','semi-pro','college','varsity','jv','amateur'))",
    # another column
    DROP + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (status IN {WIDER})",
    # not a plain IN list
    DROP + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER} OR level IS NULL)",
    DROP + "ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (length(level) > 0)",
    DROP + "ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN (select level from x))",
    # another table, a DROP alone, a DROP not directly followed by its ADD, an ADD alone, a constraint not in the live list
    DROP + f"ALTER TABLE sport_programs ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})",
    DROP,
    DROP + "ALTER TABLE x ADD COLUMN IF NOT EXISTS y INTEGER;\n"
         + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})",
    f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})",
    "ALTER TABLE sport_events DROP CONSTRAINT sport_events_gender_check;\n"
    + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_gender_check CHECK (gender IN {WIDER})",
    "ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_level_check;\n"
    + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})",
])
def test_widening_allowance_is_narrow(sql):
    assert check_additive(sql, LIVE) != []


def test_widening_without_live_checks_is_refused():
    assert check_additive(DROP + f"ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN {WIDER})") != []


def test_single_add_column_lines_from_committed_migrations_pass():
    # verbatim from 024, 053, 032, 026 (all applied long ago): INT, INT DEFAULT, REFERENCES without a space, TEXT[] NOT NULL DEFAULT
    for stmt in [
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS legistar_matter_ids INT[] NOT NULL DEFAULT '{}'",
        "ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS docs_attempted INT DEFAULT 0",
        "ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS traffic_incident_id BIGINT REFERENCES traffic_incidents(id)",
        "ALTER TABLE facilities ADD COLUMN IF NOT EXISTS name_aliases TEXT[] NOT NULL DEFAULT '{}'",
    ]:
        assert check_additive(stmt) == [], stmt
