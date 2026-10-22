"""publish_table() holds a UK record BEFORE any AI call (Glasgow phase 5)."""
from datetime import datetime, timezone
from unittest.mock import MagicMock

from ai_pipeline import publish


def _conn(rows):
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn


def _row(text):
    return {"id": 1, "town_id": "glasgow", "body": "Planning Applications Committee",
            "meeting_date": datetime(2026, 11, 3, 9, 30, tzinfo=timezone.utc),
            "raw_data": {"agenda_text": text}, "content_hash": "h"}


def _patch(monkeypatch, calls):
    monkeypatch.setattr(publish, "load_given_up_records", lambda *a: {})
    monkeypatch.setattr(publish, "has_substance", lambda *a: True)
    monkeypatch.setattr(publish, "is_current", lambda *a: True)
    monkeypatch.setattr(publish, "already_has_a_story", lambda *a: False)
    monkeypatch.setattr(publish, "format_record", lambda *a, **k: calls.append(1) or (_ for _ in ()).throw(RuntimeError("AI called")))


def test_held_record_never_reaches_the_ai(monkeypatch, capsys):
    calls = []
    _patch(monkeypatch, calls)
    cfg = {"town_id": "glasgow", "country": "gb", "timezone": "Europe/London"}
    slugs = set()
    out = publish.publish_table(_conn([_row("Application by John Smith for 12 High Street")]), cfg, "meetings", slugs)
    assert calls == [] and out[0] == 0 and slugs == set()
    assert "HOLD" in capsys.readouterr().out


def test_us_town_is_not_gated(monkeypatch):
    calls = []
    _patch(monkeypatch, calls)
    cfg = {"town_id": "brookings_sd", "country": "us", "timezone": "America/Chicago"}
    try:
        publish.publish_table(_conn([_row("Application by John Smith for 12 High Street")]), cfg, "meetings", set())
    except RuntimeError as e:
        assert str(e) == "AI called"
    assert calls == [1]
