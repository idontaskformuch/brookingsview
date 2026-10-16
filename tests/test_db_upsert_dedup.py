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
