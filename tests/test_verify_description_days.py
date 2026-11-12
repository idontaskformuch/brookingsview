"""QA build.description-day (2026-11-12): a /s/ or /whats-on/ page's meta description names the day its date line shows.

before/ = glasgow /s/event-series-2e15f0f2497a5f8f/ (Saturday Art Club) built locally on 416b535: the description said
"Saturday 14 Nov 2026" while the page's date line said "Regular · Sat 10:30am". after/ = the same page built with the fix."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_description_day_2026-11-12"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_description_days.mjs"), str(dist)],
                          capture_output=True, text=True, encoding="utf-8")


def test_a_series_page_whose_description_fixes_one_date_fails():
    r = run(FIX / "before")
    assert r.returncode == 1
    assert '/s/event-series-2e15f0f2497a5f8f/: the description names "Saturday 14 Nov 2026", the page shows no date' in r.stderr


def test_the_series_page_with_the_kicker_description_passes():
    assert (FIX / "after" / "s" / "event-series-2e15f0f2497a5f8f" / "index.html").exists()
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr
