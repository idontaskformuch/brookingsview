"""QA build.hours-schema-fresh (found 2026-11-12 on Broomfield's /today/).

before/ = broomfieldview.com/facilities/library/ as served 2026-11-13 (build 5beb348): hours in JSON-LD although places.verified_date
(slug 'library', town broomfield_co) is 2026-09-13, 61 days old against a 45-day limit. stale/ = the same page with the one changed
field: the checked date wrapped in <time datetime="2026-09-13">, as the fixed template writes it, with the schema still in.
after/ = the same page from the fixed Broomfield build (no hours in JSON-LD)."""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_hours_schema_fresh_2026-11-13"


def run(dist: Path, now: str = "2026-11-13T12:00:00Z") -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_hours_schema_fresh.mjs"), str(dist)], capture_output=True,
                          text=True, encoding="utf-8", env={**os.environ, "QA_NOW": now})


def test_served_page_fails():
    r = run(FIX / "before")
    assert r.returncode == 1
    assert "facilities/library: hours in JSON-LD but no checked <time datetime>" in r.stderr


def test_stale_date_with_schema_fails():
    r = run(FIX / "stale")
    assert r.returncode == 1
    assert "checked 2026-09-13 (61 days, limit 45)" in r.stderr


def test_same_date_within_limit_passes():
    assert run(FIX / "stale", now="2026-10-20T12:00:00Z").returncode == 0


def test_fixed_build_passes():
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr
