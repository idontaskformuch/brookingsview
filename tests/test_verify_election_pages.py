"""QA build.election-pages + build.about-empty (Broomfield AdSense plan F5/F8, owner B4, 2026-11-11).

before/ = broomfieldview.com as served 2026-11-11 (build 9bbe587): /election-results/ said "Live results ... change as
counting continues" with an empty About box, /vote/ was indexable and linked. after/ = the fixed Broomfield build."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_election_pages_2026-11-11"


def run(script: str, dist: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / script), str(dist), *extra], capture_output=True, text=True, encoding="utf-8")


def test_served_pages_fail_the_election_check():
    r = run("verify_election_pages.mjs", FIX / "before", "--today", "2026-11-11")
    assert r.returncode == 1
    for msg in ('says "Live results"', "counting continues", "/vote/: not noindex", "/election-results/: links to /vote/"):
        assert msg in r.stderr


def test_served_results_page_has_an_empty_about_box():
    r = run("verify_no_empty_messages.mjs", FIX / "before")
    assert r.returncode == 1 and '/election-results/: "About this page" heading with no text under it' in r.stderr


def test_fixed_build_passes_both():
    assert run("verify_election_pages.mjs", FIX / "after", "--today", "2026-11-11").returncode == 0
    r = run("verify_no_empty_messages.mjs", FIX / "after")
    assert r.returncode == 0, r.stderr


def test_before_election_day_nothing_is_checked():
    assert run("verify_election_pages.mjs", FIX / "before", "--today", "2026-11-03").returncode == 0


HOLIDAY = ROOT / "tests" / "fixtures" / "qa_holiday_unconfirmed_2026-11-11"


def test_served_holiday_pages_fail_on_unconfirmed_status_text():
    # QA build.holiday-unconfirmed (F9, 2026-11-11): /thanksgiving/ and /veterans-day/ as served on broomfieldview.com.
    r = run("verify_no_empty_messages.mjs", HOLIDAY)
    assert r.returncode == 1
    for msg in ('/thanksgiving/: status text "Not confirmed"', '/thanksgiving/: status text "Page lists no year"', '/veterans-day/: status text "Not confirmed"'):
        assert msg in r.stderr


AI_STATEMENT = ROOT / "tests" / "fixtures" / "qa_ai_statement_2026-11-11"


def test_served_pages_fail_on_the_old_ai_statement():
    # QA build.ai-statement (owner B6, 2026-11-11): /advertising/, /how-we-gather-this/ and llms.txt as served on broomfieldview.com.
    r = run("verify_no_empty_messages.mjs", AI_STATEMENT)
    assert r.returncode == 1
    for msg in ('/advertising/: old AI statement', '/how-we-gather-this/: old AI statement', '/llms.txt: old AI statement'):
        assert msg in r.stderr
