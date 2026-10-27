"""Every deploy workflow goes through scripts/wrangler_deploy_retry.sh (2 retries with a pause), owner 2026-10-27."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "wrangler_deploy_retry.sh"
BASH = shutil.which("bash")


def test_no_workflow_calls_wrangler_deploy_directly():
    offenders = []
    for wf in (ROOT / ".github" / "workflows").glob("*.yml"):
        for n, line in enumerate(wf.read_text(encoding="utf8").splitlines(), 1):
            if re.search(r"^\s*run:\s*.*wrangler deploy", line):
                offenders.append(f"{wf.name}:{n}")
    assert offenders == []


def _run(tmp_path, fails_until):
    counter = tmp_path / "n"
    counter.write_text("0")
    fake = tmp_path / "fake.sh"
    fake.write_text(f'n=$(cat "{counter.as_posix()}"); n=$((n+1)); echo $n > "{counter.as_posix()}"; [ $n -ge {fails_until} ]\n')
    env = dict(os.environ, DEPLOY_RETRY_PAUSE="0", DEPLOY_CMD=f"bash {fake.as_posix()}")
    r = subprocess.run([BASH, SCRIPT.as_posix(), "--env", "x"], env=env, capture_output=True, text=True)
    return r.returncode, int(counter.read_text())


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_succeeds_on_third_attempt(tmp_path):
    assert _run(tmp_path, 3) == (0, 3)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_gives_up_after_three_attempts_with_the_exit_code(tmp_path):
    assert _run(tmp_path, 4) == (1, 3)
