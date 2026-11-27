"""place_hours.time_unknown (owner 2026-11-27, migration 079). A place_hours row without times means CLOSED, except when
time_unknown is set: the source gives the day but no clock time (/help/ rows, cross-of-christ-community-meals). Every Python
reader of place_hours either leaves those rows out, reads the marker, or is listed below with the reason it counts every row.
The site's readers: site/src/lib/place-hours-time-unknown.test.ts."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from db import help_places as hp
from scripts import apply_migration

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "db" / "migrations" / "079_place_hours_time_unknown.sql"

# (file, text in the statement) -> why this reader counts every row, marker or not
COUNTS_EVERY_ROW = {
    ("scrapers/facility_hours.py", "(SELECT count(*) FROM place_hours ph WHERE ph.place_id = p.id), name_aliases"):
        "any row = the place has its own hours: the Brookings catalog never rewrites it",
    ("scripts/check_freshness.py", "OR EXISTS (SELECT 1 FROM place_hours ph WHERE ph.place_id = p.id)"):
        "a day without a time is still a source fact that needs re-verifying",
    ("scripts/order_d_conflicts.py", "(SELECT count(*) FROM place_hours ph WHERE ph.place_id = p.id) FROM places p"):
        "one-off script (order D, 2026-11-25): prints a row count, decides nothing",
}

_READ = re.compile(r"(?<!DELETE )\b(?:FROM|JOIN) place_hours\b(?!_)")


def _statements():
    """(file, the source line with the read + the next line, where the statement's string usually continues) for every
    SELECT/JOIN on place_hours in Python code outside tests."""
    for folder in ("ai_pipeline", "db", "scrapers", "scripts", "qa"):
        for path in (ROOT / folder).rglob("*.py"):
            lines = path.read_text(encoding="utf-8").splitlines()
            for i, line in enumerate(lines):
                if _READ.search(line):
                    yield path.relative_to(ROOT).as_posix(), " ".join(x.strip() for x in lines[i:i + 2])


def test_every_python_reader_handles_time_unknown():
    found = list(_statements())
    assert len(found) == 6, f"a new place_hours reader: decide how it treats time_unknown, then count it here: {found}"
    for file, line in found:
        listed = any(file == f and text in line for f, text in COUNTS_EVERY_ROW)
        assert listed or "time_unknown" in line, (file, line)


def test_migration_is_additive_and_defaults_to_closed_semantics():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert apply_migration.check_additive(sql) == []
    assert "time_unknown BOOLEAN NOT NULL DEFAULT false" in sql   # every existing row keeps meaning "closed" when times are null


def test_help_schedule_marks_a_day_without_a_time():
    # cross-of-christ-community-meals (id 330): 1st and 3rd Tuesday, no clock time on the source page; one row, Tue Dec 1.
    calls = []

    class Cur:
        def execute(self, sql, params=()):
            calls.append((" ".join(sql.split()), params))

    hp.write_schedule(Cur(), 330, weekly=[], dates=[(date(2026, 12, 1), None, None), (date(2026, 12, 2), "17:30", "19:00")],
                      closed=[], source_url="https://cross-of-christ.org/serve/outreach-support/", today=date(2026, 11, 27))
    rows = [p for s, p in calls if s.startswith("INSERT INTO place_hours ")]
    assert all("time_unknown" in s for s, _ in calls if s.startswith("INSERT INTO place_hours "))
    assert rows == [(330, 2, None, None, date(2026, 12, 1), date(2026, 12, 1), True),
                    (330, 3, "17:30", "19:00", date(2026, 12, 2), date(2026, 12, 2), False)]   # 2nd row: only the times changed


def test_hours_consistency_reports_a_time_unknown_row():
    from scripts import check_hours_consistency as chc
    assert "time_unknown" in Path(chc.__file__).read_text(encoding="utf-8")
