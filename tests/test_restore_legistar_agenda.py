"""Legistar raw_data-overwrite recovery -- see scripts/restore_legistar_
agenda_from_snapshot.py's own module docstring. Mock connection/cursor
(no real DB), same convention as tests/test_db_upsert_dedup.py.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock

from scripts.restore_legistar_agenda_from_snapshot import last_known_good_agenda

UTC = timezone.utc

REAL_ITEM = {
    "EventItemId": 94873, "EventItemAgendaNumber": "6b.",
    "EventItemTitle": "Rezone Lot 1 of Clark 2nd Addition",
    "EventItemMatterId": 8903, "EventItemPassedFlagName": "Pass",
}


def _fake_conn(snapshot_rows):
    cur = MagicMock()
    cur.fetchall.return_value = snapshot_rows
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn


def _snapshot(id_, fetched_at, events):
    import json
    return {"id": id_, "fetched_at": fetched_at, "raw": json.dumps(events).encode("utf-8")}


def test_picks_the_last_snapshot_with_non_empty_items():
    t1 = datetime(2026, 8, 1, tzinfo=UTC)
    t2 = datetime(2026, 9, 1, tzinfo=UTC)
    t3 = datetime(2026, 10, 15, tzinfo=UTC)  # the loss -- empty items
    snapshots = [
        _snapshot(1, t1, [{"EventId": 3796, "_agenda_items": [REAL_ITEM]}]),
        _snapshot(2, t2, [{"EventId": 3796, "_agenda_items": [REAL_ITEM]}]),
        _snapshot(3, t3, [{"EventId": 3796, "_agenda_items": []}]),
    ]
    conn = _fake_conn(snapshots)
    result = last_known_good_agenda(conn, "3796")
    assert result is not None
    assert result["fetched_at"] == t2
    assert len(result["agenda_items"]) == 1
    assert result["agenda_items"][0]["EventItemTitle"] == "Rezone Lot 1 of Clark 2nd Addition"
    assert "Rezone Lot 1 of Clark 2nd Addition" in result["agenda_text"]


def test_returns_none_when_no_snapshot_ever_had_items():
    snapshots = [
        _snapshot(1, datetime(2026, 8, 1, tzinfo=UTC), [{"EventId": 3796, "_agenda_items": []}]),
        _snapshot(2, datetime(2026, 9, 1, tzinfo=UTC), [{"EventId": 3796, "_agenda_items": []}]),
    ]
    conn = _fake_conn(snapshots)
    assert last_known_good_agenda(conn, "3796") is None


def test_returns_none_when_event_id_never_appears_in_any_snapshot():
    snapshots = [_snapshot(1, datetime(2026, 8, 1, tzinfo=UTC), [{"EventId": 9999, "_agenda_items": [REAL_ITEM]}])]
    conn = _fake_conn(snapshots)
    assert last_known_good_agenda(conn, "3796") is None


def test_ignores_an_unparseable_snapshot_rather_than_crashing():
    good = _snapshot(2, datetime(2026, 9, 1, tzinfo=UTC), [{"EventId": 3796, "_agenda_items": [REAL_ITEM]}])
    bad = {"id": 1, "fetched_at": datetime(2026, 8, 1, tzinfo=UTC), "raw": b"not json"}
    conn = _fake_conn([bad, good])
    result = last_known_good_agenda(conn, "3796")
    assert result is not None
    assert len(result["agenda_items"]) == 1
