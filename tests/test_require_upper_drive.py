"""QA build.lowercase-drive (owner 2026-11-25): from a working directory with a lowercase Windows drive letter ("c:\\...") `astro build`
exited 0 with no component CSS on any page (432 of 433 Brookings pages, Fas 4 Facilities, 2026-11-25); the same commit from "C:\\..."
carried CSS on all 433. site/scripts/require-upper-drive.mjs refuses such a directory; site/astro.config.mjs (every astro build, check,
dev and vitest) and scripts/battery.sh (before any step) call it. Before the fix none of this existed and these tests fail."""
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "site" / "scripts" / "require-upper-drive.mjs"


def problem(cwd: str) -> str:
    code = (
        f"import('{GUARD.as_uri()}').then((m) => process.stdout.write(String(m.driveLetterProblem({cwd!r}))))"
    )
    return subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", check=True).stdout


def test_lowercase_drive_is_refused_with_the_fix_in_the_message():
    msg = problem("c:\\Users\\claud\\Documents\\hemsidor\\brookingsview\\site")
    assert msg.startswith("REFUSED") and "C:\\Users\\claud\\Documents\\hemsidor\\brookingsview\\site" in msg, msg


def test_uppercase_drive_and_no_drive_pass():
    assert problem("C:\\Users\\claud\\Documents\\hemsidor\\brookingsview\\site") == "null"
    assert problem("C:/Users/claud") == "null"
    assert problem("/home/runner/work/brookingsview/site") == "null"  # CI (Linux)


def test_build_config_and_battery_call_the_guard():
    config = (ROOT / "site" / "astro.config.mjs").read_text(encoding="utf-8")
    assert "from './scripts/require-upper-drive.mjs'" in config
    assert "driveLetterProblem(process.cwd())" in config and "throw new Error(problem)" in config
    battery = (ROOT / "scripts" / "battery.sh").read_text(encoding="utf-8")
    guard = battery.index('node "$ROOT/site/scripts/require-upper-drive.mjs" || {')
    assert guard < battery.index("pytest tests/") and guard < battery.index('ROOT="$(cd "$ROOT" && { pwd -W')


def _lowercase(p: Path) -> str:
    s = str(p)
    return s[0].lower() + s[1:]


@pytest.mark.skipif(os.name != "nt", reason="drive letters exist only on Windows")
def test_guard_and_battery_refuse_a_real_lowercase_directory():
    low = _lowercase(ROOT)
    r = subprocess.run(["node", str(GUARD)], cwd=low, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 1 and "REFUSED" in r.stderr, r.stderr
    ok = subprocess.run(["node", str(GUARD)], cwd=str(ROOT)[0].upper() + str(ROOT)[1:], capture_output=True, text=True)
    assert ok.returncode == 0, ok.stderr
    b = subprocess.run(["bash", "scripts/battery.sh", "scratch_tmp/battery-drive-test"], cwd=low,
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert b.returncode == 2 and "AVBRUTET" in b.stderr and "pytest" not in b.stdout, (b.stdout, b.stderr)
    assert not (ROOT / "scratch_tmp" / "battery-drive-test").exists()  # refused before it made its log directory
