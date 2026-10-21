"""Coverage for db.upsert_records()'s dedup_check_columns safety net -- see
its own docstring and scrapers/parsers/escribe_v1.py's EscribeParser for the
real bug this exists to catch (a date-parsing fix silently changed
content_hash for the SAME real meeting, producing a byte-identical second
row under a new hash -- ON CONFLICT never matched the old one).

Uses a mock connection/cursor (no real DB), same convention as
tests/test_project_threads.py's candidate-queue dedup tests.
"""
from unittest.mock import MagicMock

from db.db import upsert_records


def _fake_conn(select_result):
    """conn.cursor() returns the SAME cursor for both the dedup SELECT (if
    any) and the INSERT -- fetchone() answers the canned select_result,
    rowcount is fixed at 1 so a real INSERT's new_count math works."""
    cur = MagicMock()
    cur.fetchone.return_value = select_result
    cur.rowcount = 1
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


def _executed_sql(cur, keyword):
    return [c.args[0] for c in cur.execute.call_args_list if keyword in c.args[0]]


RECORD = {
    "body": "Planning Commission",
    "meeting_date": "2026-09-24T18:00:00-07:00",
    "content_hash": "new-hash-after-the-parsing-fix",
    "raw_data": {"ID": "353244f6", "StartDate": "2026/09/24 18:00:00"},
}


def test_skips_insert_when_byte_identical_duplicate_exists():
    conn, cur = _fake_conn(select_result=(1,))  # SELECT found a match
    new_count = upsert_records(
        conn, "meetings", "moreno_valley_ca", [RECORD],
        dedup_check_columns=("body", "meeting_date"),
    )
    assert new_count == 0
    assert _executed_sql(cur, "INSERT") == []
    assert len(_executed_sql(cur, "SELECT")) == 1


def test_inserts_normally_when_no_duplicate_found():
    conn, cur = _fake_conn(select_result=None)  # SELECT found nothing
    new_count = upsert_records(
        conn, "meetings", "moreno_valley_ca", [RECORD],
        dedup_check_columns=("body", "meeting_date"),
    )
    assert new_count == 1
    assert len(_executed_sql(cur, "INSERT")) == 1


def test_no_dedup_check_ran_when_columns_not_given():
    # Every other table's call site (no dedup_check_columns) must see
    # EXACTLY today's behavior -- no extra SELECT at all.
    conn, cur = _fake_conn(select_result=None)
    new_count = upsert_records(conn, "meetings", "moreno_valley_ca", [RECORD])
    assert new_count == 1
    assert _executed_sql(cur, "SELECT") == []


# merge_raw_data -- see db.upsert_records()'s own doc comment for the real
# live data-loss bug this closes (2026-10-15): Legistar/AgendaLink/eSCRIBE
# only set raw_data["agenda_items"] when a fetch returns items, and the
# OLD blind `raw_data = EXCLUDED.raw_data` replace erased the richer
# historical value the first time a source answered empty for an event
# that used to have items.
def test_merge_raw_data_true_uses_jsonb_merge_not_blind_replace():
    conn, cur = _fake_conn(select_result=None)
    upsert_records(
        conn, "meetings", "brookings_sd", [RECORD],
        update_columns=["raw_data"], merge_raw_data=True,
    )
    sql = _executed_sql(cur, "INSERT")[0]
    assert "raw_data = meetings.raw_data || EXCLUDED.raw_data" in sql


def test_merge_raw_data_false_default_is_byte_identical_to_before():
    # The ~10 other existing update_columns+raw_data callers (traffic,
    # sports, events, property sales, ...) must see EXACTLY today's SQL --
    # no merge, no regression -- since merge_raw_data defaults to False.
    conn, cur = _fake_conn(select_result=None)
    upsert_records(
        conn, "meetings", "brookings_sd", [RECORD],
        update_columns=["raw_data"],
    )
    sql = _executed_sql(cur, "INSERT")[0]
    assert "raw_data = EXCLUDED.raw_data" in sql
    assert "||" not in sql


def test_merge_raw_data_only_changes_the_raw_data_clause_not_other_columns():
    conn, cur = _fake_conn(select_result=None)
    upsert_records(
        conn, "meetings", "brookings_sd", [RECORD],
        update_columns=["body", "raw_data", "meeting_date"], merge_raw_data=True,
    )
    sql = _executed_sql(cur, "INSERT")[0]
    assert "body = EXCLUDED.body" in sql
    assert "meeting_date = EXCLUDED.meeting_date" in sql
    assert "raw_data = meetings.raw_data || EXCLUDED.raw_data" in sql


# --- identity_key: the source's own id, not content_hash, decides "same row" ---
# Real bug: meetings 13779-13791 (Moreno Valley, 2026-10-01) -- a timezone fix
# changed content_hash for 13 already-stored meetings, so every one was
# inserted again; 14586/14970 (10-15, 10-20) did it again with raw_data that
# differed, which dedup_check_columns deliberately does not catch.

IDENT_RECORD = {
    "body": "Planning Commission",
    "meeting_date": "2026-08-28T18:00:00-07:00",
    "content_hash": "a-brand-new-hash",
    "raw_data": {"ID": "6918217e", "StartDate": "2026/08/28 18:00:00", "PostMinutes": "new"},
}


def _run_identity(select_result, **kw):
    conn, cur = _fake_conn(select_result=select_result)
    new_count = upsert_records(
        conn, "meetings", "moreno_valley_ca", [IDENT_RECORD],
        update_columns=["body", "meeting_date", "raw_data"],
        identity_key="ID", **kw,
    )
    return new_count, cur


def test_identity_match_updates_existing_row_instead_of_inserting():
    new_count, cur = _run_identity(select_result=(11040,))
    assert _executed_sql(cur, "INSERT") == []
    updates = _executed_sql(cur, "UPDATE meetings")
    assert len(updates) == 1
    assert updates[0].rstrip().endswith("WHERE id = %s")
    assert cur.execute.call_args_list[-1].args[1][-1] == 11040
    assert new_count == 1  # an update counts like DO UPDATE always did


def test_identity_lookup_takes_the_oldest_row_and_is_scoped_to_the_town():
    _, cur = _run_identity(select_result=(11040,))
    select = _executed_sql(cur, "SELECT id FROM meetings")[0]
    assert "ORDER BY id LIMIT 1" in select and "town_id = %s" in select
    assert cur.execute.call_args_list[0].args[1] == ["moreno_valley_ca", "ID", "6918217e"]


def test_identity_no_match_falls_through_to_normal_insert():
    new_count, cur = _run_identity(select_result=None)
    assert len(_executed_sql(cur, "INSERT")) == 1
    assert _executed_sql(cur, "UPDATE meetings") == []
    assert new_count == 1


def test_identity_update_only_sets_content_hash_when_free():
    _, cur = _run_identity(select_result=(11040,))
    sql = _executed_sql(cur, "UPDATE meetings")[0]
    # UNIQUE (town_id, content_hash): a surviving duplicate may hold the new hash.
    assert "CASE WHEN NOT EXISTS" in sql and "ELSE content_hash END" in sql


def test_identity_update_merges_raw_data_when_asked():
    _, cur = _run_identity(select_result=(11040,), merge_raw_data=True)
    assert "meetings.raw_data, '{}'::jsonb) || %s" in _executed_sql(cur, "UPDATE meetings")[0]
    _, cur = _run_identity(select_result=(11040,), merge_raw_data=False)
    assert "||" not in _executed_sql(cur, "UPDATE meetings")[0].split("content_hash =")[0]


def test_identity_match_without_update_columns_changes_nothing():
    conn, cur = _fake_conn(select_result=(11040,))
    new_count = upsert_records(conn, "meetings", "moreno_valley_ca", [IDENT_RECORD],
                               identity_key="ID")
    assert new_count == 0
    assert _executed_sql(cur, "INSERT") == [] and _executed_sql(cur, "UPDATE") == []


def test_identity_key_unset_or_value_missing_is_todays_behavior():
    conn, cur = _fake_conn(select_result=None)
    upsert_records(conn, "meetings", "moreno_valley_ca", [IDENT_RECORD])
    assert _executed_sql(cur, "SELECT") == []
    conn, cur = _fake_conn(select_result=(1,))
    no_id = {**IDENT_RECORD, "raw_data": {"StartDate": "x"}}
    upsert_records(conn, "meetings", "moreno_valley_ca", [no_id], identity_key="ID")
    assert _executed_sql(cur, "SELECT") == [] and len(_executed_sql(cur, "INSERT")) == 1


def test_meetings_parsers_declare_their_sources_own_id():
    from scrapers.parsers.agendalink_v1 import AgendaLinkParser
    from scrapers.parsers.escribe_v1 import EscribeParser
    from scrapers.parsers.legistar_v1 import LegistarParser
    assert (EscribeParser.identity_key, LegistarParser.identity_key,
            AgendaLinkParser.identity_key) == ("ID", "EventId", "id")
