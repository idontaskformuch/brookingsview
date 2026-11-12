"""QA build.nav-links (Broomfield AdSense plan F3, owner B3, 2026-11-12).

before/ = broomfieldview.com as served 2026-11-12 (build 5beb348): the home page and every page its menu and footer link to.
/this-week/ answered with a redirect, so its file is the redirect stub the same build wrote to dist/. after/ = the same pages from
the fixed Broomfield build (nav pruned by site/src/lib/nav-prune.mjs)."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_nav_links_2026-11-12"


def run(dist: Path, town: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_nav_links.mjs"), str(dist), town], capture_output=True, text=True, encoding="utf-8")


def test_served_menu_fails():
    r = run(FIX / "before", "broomfield_co")
    assert r.returncode == 1
    for msg in ("/today/ (noindex)", "/this-week/ (redirect stub)", "/traffic/ (noindex)", "/jobs/ (noindex)", "/vail-resorts/ (noindex)"):
        assert msg in r.stderr


def test_fixed_build_passes():
    r = run(FIX / "after", "broomfield_co")
    assert r.returncode == 0, r.stderr


def test_towns_outside_the_rule_are_skipped():
    assert run(FIX / "before", "brookings_sd").returncode == 0
