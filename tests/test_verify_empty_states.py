"""QA build.empty-state (owner 2026-11-24: no empty-state text on any town; an empty section is left out entirely).

before/ = real Broomfield pages built locally at 66dcd830 on 2026-11-24 from the live DB: /this-week/2026-w48/ ("A quiet week -- no
meetings, events or games recorded for Broomfield this week."), /corrections/, /events/past/, and the Worker Pulse comment list
("No comments yet.") on /workplace-watch/ and /s/workplace-watch-vail-resorts-2026-11/. /traffic/ is the same build's page, there
only so the "no traffic page" link check sees a town that has one. after/ = the same pages from the fixed build."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_empty_states_2026-11-24"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_no_empty_messages.mjs"), str(dist)],
                          capture_output=True, text=True, encoding="utf-8")


def test_built_empty_states_fail_the_build():
    r = run(FIX / "before")
    assert r.returncode == 1
    for msg in ('/this-week/2026-w48/: empty message "A quiet week"',
                '/this-week/2026-w48/: empty-state markup class="empty"',
                '/corrections/: empty message "No corrections have been logged"',
                '/events/past/: empty-state markup class="empty"',
                '/workplace-watch/: empty-state markup class="wp-comments__empty"',
                '/s/workplace-watch-vail-resorts-2026-11/: empty message "No comments yet"'):
        assert msg in r.stderr, r.stderr


def test_markup_alone_fails_whatever_the_wording(tmp_path):
    # the real w48 page with the one changed field: the empty line's wording (the class stays), so only the markup rule can catch it
    page = (FIX / "before" / "this-week" / "2026-w48" / "index.html").read_text(encoding="utf-8")
    assert "A quiet week" in page
    out = tmp_path / "this-week" / "2026-w48"
    out.mkdir(parents=True)
    (out / "index.html").write_text(page.replace("A quiet week", "Slow days"), encoding="utf-8")
    (tmp_path / "traffic").mkdir()
    (tmp_path / "traffic" / "index.html").write_text((FIX / "before" / "traffic" / "index.html").read_text(encoding="utf-8"), encoding="utf-8")
    r = run(tmp_path)
    assert r.returncode == 1 and 'empty-state markup class="empty"' in r.stderr, r.stderr


def test_fixed_build_passes():
    r = run(FIX / "after")
    assert r.returncode == 0, r.stderr
