"""QA build.today-page (Broomfield AdSense plan F3, owner yes 2026-11-12).

before/ = broomfieldview.com/today/ as served 2026-11-12 (build 5beb348): "Turn on JavaScript", no date. after/ = the same page from the
fixed Broomfield build."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_today_page_2026-11-12"


def run(dist: Path, town: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_today_page.mjs"), str(dist), town], capture_output=True, text=True, encoding="utf-8")


def test_served_page_fails():
    r = run(FIX / "before", "broomfield_co")
    assert r.returncode == 1
    assert 'says "Turn on JavaScript"' in r.stderr and "no visible date" in r.stderr


def test_fixed_build_passes():
    r = run(FIX / "after", "broomfield_co")
    assert r.returncode == 0, r.stderr


def test_every_town_is_checked_since_2026_11_25():
    # Owner 2026-11-25: todayPage for Brookings, Moreno Valley and Glasgow too, so the served "Turn on JavaScript" page fails for them.
    for town in ("brookings_sd", "moreno_valley_ca", "glasgow"):
        assert run(FIX / "before", town).returncode == 1, town


def test_a_town_without_todaypage_is_skipped():
    # No real town is left without todayPage; an id outside TODAY_PAGE_TOWNS stands in for the next one added.
    r = run(FIX / "before", "not_a_configured_town")
    assert r.returncode == 0 and "no todayPage config, skipped" in r.stdout
