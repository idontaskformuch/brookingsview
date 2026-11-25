"""QA build.page-css (2026-11-25): a green Astro build shipped no component CSS on any page after a JS comment was put inside a
template expression in components/CookieBanner.astro. after/ = the real Glasgow /today/ of the fixed build (2026-11-25);
before/ = the same page with only its <style> blocks and /_astro/*.css links removed, which is what the broken build served."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_page_css_2026-11-25"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_page_css.mjs"), str(dist)], capture_output=True, text=True, encoding="utf-8")


def test_page_without_css_fails():
    r = run(FIX / "before")
    assert r.returncode == 1 and "/today/" in r.stderr, r.stderr


def test_fixed_page_passes():
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr


def test_cookie_banner_has_no_comment_inside_its_template():
    src = (ROOT / "site" / "src" / "components" / "CookieBanner.astro").read_text(encoding="utf-8")
    template = src.split("---", 2)[2].split("<style>", 1)[0]
    assert "/*" not in template and "//" not in template.replace("https://", "")


def test_every_deploy_is_gated():
    """Owner 2026-11-25: a page without CSS can never be deployed. Every deploy goes through scripts/wrangler_deploy_retry.sh
    (tests/test_wrangler_deploy_retry.py: no workflow calls wrangler deploy directly), which runs the check before wrangler; the four
    *-deploy.yml also run it as a named step next to the other dist checks."""
    script = (ROOT / "scripts" / "wrangler_deploy_retry.sh").read_text(encoding="utf-8")
    assert 'node "$(dirname "$0")/verify_page_css.mjs" dist' in script
    assert script.index("verify_page_css.mjs") < script.index("$cmd \"$@\"")
    for wf in ("deploy.yml", "glasgow-deploy.yml", "broomfield-deploy.yml", "moval-deploy.yml"):
        assert "run: node scripts/verify_page_css.mjs site/dist" in (ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8"), wf
