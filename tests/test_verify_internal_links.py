"""QA build.internal-links (Broomfield AdSense plan F18, 2026-11-13).

before/ = pages from the Broomfield build of 2c547f8 (2026-11-13, before the fix), copied from dist/: /tonight/, /vail-resorts/,
/this-week/2026-w37/, /events/ and the redirect stubs /sports/, /reviews/, /this-week/ the same build wrote. The two sport detail
pages /tonight/ linked were never built, so they are absent here too. The fixture holds only these pages, so every other link on
them is reported as missing as well; the test asserts the five real failures. The fixed full build is checked in broomfield-deploy.yml."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_internal_links_2026-11-13"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_internal_links.mjs"), str(dist)], capture_output=True, text=True, encoding="utf-8")


def test_served_links_fail():
    r = run(FIX / "before")
    assert r.returncode == 1
    for msg in (
        "/whats-on/denver-pioneers-hockey-vs-lindenwood-lions-mens-hockey-Z7r9jZ1A7x_Cd/ (missing) linked from 1 page(s): /tonight/",
        "/whats-on/colorado-buffaloes-football-vs-houston-cougars-football-Z7r9jZ1A7OEko/ (missing) linked from 1 page(s): /tonight/",
        "/reviews/ (redirect stub) linked from 1 page(s): /vail-resorts/",
        "/sports/ (redirect stub) linked from 1 page(s): /this-week/2026-w37/",
        "/this-week/ (redirect stub) linked from 1 page(s): /events/",
    ):
        assert msg in r.stderr


def test_stub_pages_are_not_sources():
    r = run(FIX / "before")
    assert "linked from 1 page(s): /sports/" not in r.stderr
    assert "across 4 page(s)" in r.stderr


GLASGOW = ROOT / "tests" / "fixtures" / "qa_internal_links_glasgow_2026-11-13"


def test_related_link_to_pruned_event_fails():
    """before/ = /s/event-318275/ from the Glasgow build of 275ae5c (2026-11-13): its related list linked /s/event-331655/
    (Chatterbooks Book Group for Children, 15 Sep), an event older than PRUNE_EVENT_AFTER_DAYS whose page is not built.
    Fixed in lib/db.ts getRelatedStories (same day count as lib/old-events.ts)."""
    r = run(GLASGOW / "before")
    assert r.returncode == 1
    assert "/s/event-331655/ (missing) linked from 1 page(s): /s/event-318275/" in r.stderr
