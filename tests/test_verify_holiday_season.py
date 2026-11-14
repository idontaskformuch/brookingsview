"""QA build.holiday-season (owner 2026-11-14, .claude/specs/glasgow-christmas-2026.md): Glasgow's /christmas/ never shows a passed
day or event, and every card has a source link.

built/ = the Glasgow /christmas/ page as built 2026-11-14 (first build of the day-by-day page). The same page checked as if it were
25 Dec is the passed-dates case. nosource/ = the same page with one change: the source of the first ScotRail card removed."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_holiday_season_2026-11-14"


def run(dist: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_holiday_season.mjs"), str(dist), *extra],
                          capture_output=True, text=True, encoding="utf-8")


def test_the_built_page_passes_on_its_build_day():
    r = run(FIX / "built", "--today", "2026-11-14")
    assert r.returncode == 0, r.stderr


def test_the_same_page_fails_once_its_days_have_passed():
    r = run(FIX / "built", "--today", "2026-12-25")
    assert r.returncode == 1
    assert "/christmas/: shows the passed day 2026-12-24" in r.stderr
    assert "/christmas/: shows an event that ended 2026-12-23" in r.stderr


def test_a_card_without_its_source_link_fails():
    r = run(FIX / "nosource", "--today", "2026-11-14")
    assert r.returncode == 1
    assert "an item without a source link" in r.stderr
    assert "FAIL: 1 problem(s)" in r.stderr
