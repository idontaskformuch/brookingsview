"""The four deploy workflows build through scripts/build_retry.sh: ONE retry after 30 s, only on a transient DB/network error (owner 2026-11-07)."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "build_retry.sh"
BASH = shutil.which("bash")
DEPLOYS = ["deploy.yml", "moval-deploy.yml", "broomfield-deploy.yml", "glasgow-deploy.yml"]


@pytest.mark.parametrize("wf", DEPLOYS)
def test_deploy_workflow_builds_through_retry_script(wf):
    text = (ROOT / ".github" / "workflows" / wf).read_text(encoding="utf8")
    assert "run: bash ../scripts/build_retry.sh" in text
    assert "run: npx astro build" not in text


def _run(tmp_path, fails, msg):
    counter = tmp_path / "n"
    counter.write_text("0")
    fake = tmp_path / "fake.sh"
    fake.write_text(
        f'n=$(cat "{counter.as_posix()}"); n=$((n+1)); echo $n > "{counter.as_posix()}"; '
        f'[ $n -gt {fails} ] && exit 0; echo "{msg}"; exit 1\n'
    )
    sleeps = tmp_path / "sleeps"
    stub = tmp_path / "sleep_stub.sh"
    stub.write_text('echo "sleep $1" >> "$SLEEP_LOG"\n')
    env = dict(os.environ, BUILD_CMD=f"bash {fake.as_posix()}", BUILD_SLEEP_CMD=f"bash {stub.as_posix()}", SLEEP_LOG=sleeps.as_posix())
    r = subprocess.run([BASH, SCRIPT.as_posix()], env=env, capture_output=True, text=True)
    return r.returncode, int(counter.read_text()), r.stderr, sleeps.read_text() if sleeps.exists() else ""


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_transient_error_retried_once_after_30s_and_logged(tmp_path):
    rc, n, err, sleeps = _run(tmp_path, 1, "TypeError: fetch failed")
    assert (rc, n) == (0, 2)
    assert sleeps.split() == ["sleep", "30"]
    assert "BUILD RETRY" in err


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_transient_error_twice_fails_after_one_retry(tmp_path):
    rc, n, err, _ = _run(tmp_path, 5, "fetch failed")
    assert (rc, n) == (1, 2)
    assert "failed again" in err


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_real_build_error_fails_at_once(tmp_path):
    rc, n, err, sleeps = _run(tmp_path, 5, "error ts(2322): Type 'string' is not assignable")
    assert (rc, n) == (1, 1)
    assert sleeps == ""
    assert "not retrying" in err
