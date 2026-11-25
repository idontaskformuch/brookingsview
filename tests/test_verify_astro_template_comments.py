"""QA build.astro-template-comment (owner 2026-11-25): no JS comment (// or /* */) inside an Astro template; the frontmatter is fine.

Twice on 2026-11-25 such a comment gave a green build with no component CSS on any page. before/ holds those two versions:
  - CookieBanner.e8bfdd50.astro: verbatim from commit e8bfdd50 (`{optIn ? ( /* ... */ <p>`);
  - MeetingsUpcoming.0d1a1347-working-copy.astro: commit 0d1a1347's file with its one frontmatter note put back where the working copy
    had it, as `{/* ... */}` inside `{next && (<section>...` (that copy was built, lost its CSS, and was fixed before the commit).
after/ holds the fixed files: CookieBanner from ddec8553, MeetingsUpcoming from 0d1a1347."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_astro_template_comments_2026-11-25"
SCRIPT = ROOT / "scripts" / "verify_astro_template_comments.mjs"


def run(*paths: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(SCRIPT), *map(str, paths)], capture_output=True, text=True, encoding="utf-8")


def test_both_versions_that_lost_their_css_fail():
    r = run(FIX / "before" / "CookieBanner.e8bfdd50.astro")
    assert r.returncode == 1 and "CookieBanner.e8bfdd50.astro:19: /* Owner 2026-11-25" in r.stderr, r.stderr
    r = run(FIX / "before" / "MeetingsUpcoming.0d1a1347-working-copy.astro")
    assert r.returncode == 1 and "MeetingsUpcoming.0d1a1347-working-copy.astro:36: /* Owner 2026-11-25" in r.stderr, r.stderr


def test_the_fixed_versions_pass():
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr


def test_frontmatter_script_and_text_are_not_comments(tmp_path):
    # the fixed CookieBanner (ddec8553) with the one changed thing pointed out: a // in its <script> and "a // b" as text, both fine
    src = (FIX / "after" / "CookieBanner.ddec8553.astro").read_text(encoding="utf-8")
    assert "// Opt-in text (owner 2026-11-25)" in src.split("---", 2)[1]  # frontmatter comment: allowed
    assert "<script>" in src and "//" in src.split("<script>", 1)[1]       # script comments: allowed
    f = tmp_path / "Banner.astro"
    f.write_text(src.replace("Read more</a>", "Read more // here</a>"), encoding="utf-8")
    assert run(f).returncode == 0


def test_the_whole_site_is_clean():
    r = run(ROOT / "site" / "src")
    assert r.returncode == 0, r.stderr
