"""QA build.description-venue (2026-11-12): a /s/ page's meta description does not add a place its headline already names.

before/ = moreno_valley_ca /s/event-163864/ (MAIN LIBRARY: Pijama y Cuentos ~ Pajamas & Stories) built locally on 2261bb6 (live):
the description said "... at Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA, Wed, Dec 16, 2026.". after/ = the
same page built with the fix."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_description_venue_2026-11-12"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_description_venue.mjs"), str(dist)],
                          capture_output=True, text=True, encoding="utf-8")


def test_a_description_that_adds_the_headlines_place_fails():
    r = run(FIX / "before")
    assert r.returncode == 1
    assert '/s/event-163864/: the description adds "Main Library", which the headline already names' in r.stderr


def test_the_page_without_the_repeated_place_passes():
    assert (FIX / "after" / "s" / "event-163864" / "index.html").exists()
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr
