"""QA build.meta-missing (2026-11-12): no built page may lack a meta description, noindex pages included.

before/ = glasgowloop.co.uk/s/meeting-2026-11-17-15082/ as served 2026-11-12 (build 49e7892): <meta name="description" content>,
because /s/[slug].astro passed publicBody() (empty for withheld text) and BaseLayout printed it. after/ = the same page with the
facts description the fixed page builds."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_meta_missing_2026-11-12"


def run(dist: Path, out: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "report_meta_descriptions.mjs"), str(dist), str(out)],
                          capture_output=True, text=True, encoding="utf-8")


def test_the_served_noindex_page_without_a_description_fails(tmp_path):
    r = run(FIX / "before", tmp_path / "m.tsv")
    assert r.returncode == 1 and "/s/meeting-2026-11-17-15082/ [missing]" in r.stderr


def test_the_page_with_a_facts_description_passes(tmp_path):
    r = run(FIX / "after", tmp_path / "m.tsv")
    assert r.returncode == 0, r.stderr
