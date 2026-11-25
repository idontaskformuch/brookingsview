"""scripts/sync_place_hours_from_text.py: a plain week sets hours_confidence='structured' (2026-11-25, owner order).

hours_text values verbatim from live brookings_sd rows: brookings-municipal-liquor-store (a plain week, synced 2026-11-25
without hours_confidence, so /today's "Hours today" left it out) and pioneer-park (sunrise: no place_hours rows)."""
import contextlib
import sys

import scripts.sync_place_hours_from_text as sync


def _run(monkeypatch, hours_text: str) -> list[tuple[str, tuple]]:
    calls: list[tuple[str, tuple]] = []

    class Cur:
        def execute(self, sql, params=None):
            calls.append((" ".join(sql.split()), params))

        def fetchone(self):
            return (1, hours_text)

    class Conn:
        def cursor(self):
            return contextlib.nullcontext(Cur())

    monkeypatch.setattr(sync, "get_conn", lambda: contextlib.nullcontext(Conn()))
    monkeypatch.setattr(sys, "argv", ["sync_place_hours_from_text", "brookings_sd/x", "--apply"])
    assert sync.main() == 0
    return calls


def test_plain_week_sets_structured_confidence(monkeypatch):
    calls = _run(monkeypatch, "Monday-Thursday: 9AM-8PM Friday & Saturday: 9AM-9PM Sunday: 12PM-6PM")
    updates = [sql for sql, _ in calls if sql.startswith("UPDATE places")]
    assert len(updates) == 1 and "hours_confidence = 'structured'" in updates[0]
    assert sum(sql.startswith("INSERT INTO place_hours") for sql, _ in calls) == 7


def test_sunrise_week_writes_no_rows_and_leaves_confidence(monkeypatch):
    calls = _run(monkeypatch, "Sunrise to 11:00p.m.")
    updates = [sql for sql, _ in calls if sql.startswith("UPDATE places")]
    assert len(updates) == 1 and "hours_confidence" not in updates[0]
    assert not any(sql.startswith("INSERT INTO place_hours") for sql, _ in calls)
