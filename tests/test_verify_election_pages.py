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


def test_traffic_status_line_is_an_empty_message():
    # QA build.traffic-empty (owner 2026-11-15): Broomfield's /traffic/ built 2026-11-13 05:25 from the empty read of 12 Nov 23:01 UTC,
    # with F4's "No crashes or closures reported ... as of Nov 12, 4:01 PM MST"; no town shows a message without incidents any more.
    r = run("verify_no_empty_messages.mjs", ROOT / "tests" / "fixtures" / "qa_traffic_status_line_2026-11-13")
    assert r.returncode == 1 and '/traffic/: empty message "No crashes or closures reported"' in r.stderr


def test_indexed_traffic_page_without_rows_fails():
    # QA build.traffic-empty (owner 2026-11-15, "Earlier this week"): an indexed /traffic/ is never without content under its heading.
    # Fixture = broomfieldview.com/traffic/ as served 2026-11-15 15:34 UTC (build 048329a, robots index) with its one incident row and the
    # lines that only come with rows removed: what 048329a's inertia built from the empty read of 14 Nov 23:01 UTC.
    r = run("verify_no_empty_messages.mjs", ROOT / "tests" / "fixtures" / "qa_traffic_indexed_empty_2026-11-15")
    assert r.returncode == 1 and "/traffic/: indexed with no incident row under the heading" in r.stderr


TRAFFIC_READ_TIME = ROOT / "tests" / "fixtures" / "qa_traffic_no_read_time_2026-11-16"


def test_indexed_traffic_page_without_hero_or_stale_line_fails():
    # QA build.traffic-empty (audit Fas 6a, owner 2026-11-16): an indexed /traffic/ says which read its rows come from, with the hero
    # (fresh read) or the out-of-date line. after = Moreno Valley's /traffic/ as built by 607824a on 16 Nov (hero "2 closures · As of
    # 3:25 AM PST"); before = the same page with the hero section removed, i.e. rows with no read time, as 607824a showed a read > 26 h old.
    r = run("verify_no_empty_messages.mjs", TRAFFIC_READ_TIME / "before")
    assert r.returncode == 1 and "/traffic/: indexed with neither the hero nor the out-of-date line" in r.stderr
    assert run("verify_no_empty_messages.mjs", TRAFFIC_READ_TIME / "after").returncode == 0


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


TIMELESS = ROOT / "tests" / "fixtures" / "qa_holiday_timeless_2026-11-12"


def test_standing_holiday_page_fails_on_past_tense():
    # QA build.holiday-timeless (owner 2026-11-11): the standing page never says that something happened.
    r = run("verify_no_empty_messages.mjs", TIMELESS / "before")
    assert r.returncode == 1 and '/veterans-day/: standing holiday page says "was" (past tense)' in r.stderr
    r = run("verify_no_empty_messages.mjs", TIMELESS / "after")
    assert r.returncode == 0, r.stderr


HERO_WEEKDAY = ROOT / "tests" / "fixtures" / "qa_holiday_hero_weekday_2026-11-11"


def test_holiday_hero_fails_on_repeated_weekday():
    # QA build.holiday-hero-weekday (owner 2026-11-11): "Veterans Day is Thursday, Nov 11, 2027", the weekday once.
    r = run("verify_no_empty_messages.mjs", HERO_WEEKDAY / "before")
    assert r.returncode == 1 and '/veterans-day/: holiday hero says "Thursday" twice' in r.stderr
    r = run("verify_no_empty_messages.mjs", HERO_WEEKDAY / "after")
    assert r.returncode == 0, r.stderr
