"""QA build.stub-redirects (audit Fas 1, 2026-11-16, 01-built-pages.md 5.2).

glasgow/ = four redirect stubs from the Glasgow build of d76bdd3 (site/dist, built 2026-11-16): /safety/, /advertising/ and
/university/weeks/ were served as 200 meta refreshes because Glasgow had no STATIC_GATE_REDIRECTS entry; /recipes/ is a
gone section (410) and passes either way."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_stub_redirects_2026-11-16" / "glasgow"


def run(town: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_stub_redirects.mjs"), str(FIX), town], capture_output=True, text=True, encoding="utf-8")


def test_glasgow_stubs_are_all_in_the_worker_table():
    r = run("glasgow")
    assert r.returncode == 0, r.stderr
    assert "4 stubs" in r.stdout


def test_a_town_without_entries_fails_and_names_the_paths():
    # Moreno serves /safety/ and /advertising/ for real, so the same stubs read as unserved there.
    r = run("moreno_valley_ca")
    assert r.returncode == 1
    for path in ("/advertising/", "/safety/"):
        assert path in r.stderr
    assert "/recipes/" not in r.stderr
