"""QA build.this-week-meeting-day (2026-11-12): a meeting row's day tile on /this-week/ is the day its title names.

before/ = the live /this-week/2026-w46/ pages of 2026-11-12 (build a7f1b8d): Broomfield's "City Council Regular Meeting -- Tue,
Nov 10, 2026" under "Wed Nov 11", Moreno Valley's "Planning Commission -- Thu, Nov 12, 2026" under "Fri Nov 13". after/ = the
same pages with that one row on its own day."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "qa_this_week_meeting_day_2026-11-12"


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_this_week_days.mjs"), str(dist)],
                          capture_output=True, text=True, encoding="utf-8")


def test_live_pages_fail():
    r = run(FIX / "broomfield" / "before")
    assert r.returncode == 1 and '"City Council Regular Meeting — Tue, Nov 10, 2026" is listed under day 2026-11-11' in r.stderr
    r = run(FIX / "moreno" / "before")
    assert r.returncode == 1 and '"Planning Commission — Thu, Nov 12, 2026" is listed under day 2026-11-13' in r.stderr


def test_rows_on_their_own_day_pass():
    for town in ("broomfield", "moreno"):
        r = run(FIX / town / "after")
        assert r.returncode == 0, r.stderr


def _page(tmp_path: Path, key: str, tile: str, title: str) -> Path:
    page = tmp_path / "this-week" / "2026-w46" / "index.html"
    page.parent.mkdir(parents=True)
    page.write_text(f'<ul><li class="pl__li" data-day-key="{key}"><a><span class="tile__sr">{tile}</span>'
                    f'<span class="pl__title">{title}</span></a></li></ul>', encoding="utf-8")
    return tmp_path


def test_a_tile_that_disagrees_with_its_key_fails(tmp_path):
    r = run(_page(tmp_path, "2026-11-10", "Wed Nov 11", "City Council — Tue, Nov 10, 2026"))
    assert r.returncode == 1 and 'has the tile "Wed Nov 11"' in r.stderr


def test_glasgow_title_format(tmp_path):
    assert run(_page(tmp_path, "2026-11-10", "Tue 10 Nov", "Planning Committee — Tue 10 Nov 2026")).returncode == 0


def test_rows_without_a_title_date_are_not_checked(tmp_path):
    assert run(_page(tmp_path, "2026-11-11", "Wed Nov 11", "Farmers Market")).returncode == 0
