"""QA build.local-images (astro 6-uppgraderingen, ägarens beslut 2026-11-18, .claude/specs/astro-7.md session 2).

after/ = brookingsview s/weekly-2026-w34/index.html ur baslinjebygget b17ce73 (2026-11-17, astro 5.18.2).
before/ = samma sida med det enda ändrade fältet utpekat: hero-bildens src
"/assets/images/categories/brookings_sd-events-1.png" borttagen -- det images.ts gav under astro 6 när
site/public löstes relativt dist/.prerender/chunks/ (varje lokal bild "saknades")."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_local_images_2026-11-18"


def run(dist: Path, town: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_local_images.mjs"), str(dist), town], capture_output=True, text=True, encoding="utf-8")


def test_page_without_local_images_fails():
    r = run(FIX / "before", "brookings_sd")
    assert r.returncode == 1
    assert "refererar till 0 lokala bilder" in r.stderr


def test_real_page_passes():
    r = run(FIX / "after", "brookings_sd")
    assert r.returncode == 0, r.stderr


def test_glasgow_is_skipped():
    assert run(FIX / "before", "glasgow").returncode == 0
