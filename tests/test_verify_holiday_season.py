"""QA build.holiday-season (owner 2026-11-14, .claude/specs/glasgow-christmas-2026.md): Glasgow's /christmas/ never shows a passed
day or event, every card has a source link, no day section is built without a card, and the same card has the same status pill on
every day.

built/ = the Glasgow /christmas/ page as built 2026-11-14 (first build of the day-by-day page; Mon 4 Jan was built with no card).
The same page checked as if it were 25 Dec is the passed-dates case. nosource/ = that page with one change: the source of the first
ScotRail card removed. fixed/ = the page as built 2026-11-14 after the owner's changes (no empty day). pill/ = fixed/ with one change:
the ScotRail "No trains" card on 1 Jan marked "Changed" instead of "Closed"."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_holiday_season_2026-11-14"


def run(dist: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_holiday_season.mjs"), str(dist), *extra],
                          capture_output=True, text=True, encoding="utf-8")


def test_the_fixed_page_passes_on_its_build_day():
    r = run(FIX / "fixed", "--today", "2026-11-14")
    assert r.returncode == 0, r.stderr


def test_the_first_build_fails_on_its_empty_day():
    r = run(FIX / "built", "--today", "2026-11-14")
    assert r.returncode == 1
    assert "/christmas/: the day 2027-01-04 has no card" in r.stderr
    assert "FAIL: 1 problem(s)" in r.stderr


def test_the_same_page_fails_once_its_days_have_passed():
    r = run(FIX / "built", "--today", "2026-12-25")
    assert r.returncode == 1
    assert "/christmas/: shows the passed day 2026-12-24" in r.stderr
    assert "/christmas/: shows an event that ended 2026-12-23" in r.stderr


def test_a_card_without_its_source_link_fails():
    r = run(FIX / "nosource", "--today", "2026-11-14")
    assert r.returncode == 1
    assert "an item without a source link" in r.stderr


def test_one_card_with_two_markings_fails():
    r = run(FIX / "pill", "--today", "2026-11-14")
    assert r.returncode == 1
    assert '"ScotRail · No trains" is marked "Closed" and "Changed" on different days' in r.stderr
    assert "FAIL: 1 problem(s)" in r.stderr
