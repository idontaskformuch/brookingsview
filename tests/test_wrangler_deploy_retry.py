"""Every deploy workflow goes through scripts/wrangler_deploy_retry.sh (up to 5 retries, backoff 30..480 s, only on 5xx/network errors), owner 2026-10-27, widened 2026-11-06."""
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


def _run(tmp_path, fails_until, msg="Service Unavailable [code: 503]"):
    counter = tmp_path / "n"
    counter.write_text("0")
    fake = tmp_path / "fake.sh"
    fake.write_text(
        f'n=$(cat "{counter.as_posix()}"); n=$((n+1)); echo $n > "{counter.as_posix()}"; '
        f'[ $n -ge {fails_until} ] && exit 0; echo "{msg}"; exit 1\n'
    )
    env = dict(os.environ, DEPLOY_RETRY_PAUSE="0", INDEXNOW_DELAY="0", DEPLOY_CMD=f"bash {fake.as_posix()}")
    r = subprocess.run([BASH, SCRIPT.as_posix(), "--env", "x"], env=env, capture_output=True, text=True)
    return r.returncode, int(counter.read_text()), r.stderr


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_succeeds_on_sixth_attempt_after_5xx(tmp_path):
    rc, n, _ = _run(tmp_path, 6)
    assert (rc, n) == (0, 6)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_gives_up_after_six_attempts_on_persistent_5xx(tmp_path):
    rc, n, err = _run(tmp_path, 7)
    assert (rc, n) == (1, 6)
    assert "failed after 6 attempts" in err


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_backoff_doubles_from_30_to_480(tmp_path):
    env_pause = dict(os.environ, DEPLOY_RETRY_PAUSE="30", INDEXNOW_DELAY="0")
    fake = tmp_path / "fake.sh"
    fake.write_text('echo "503 Service Unavailable"; exit 1\n')
    stub = tmp_path / "sleep_stub.sh"
    stub.write_text('echo "sleep $1" >> "$SLEEP_LOG"'+chr(10))
    log = tmp_path / "sleeps"
    env = dict(env_pause, DEPLOY_CMD=f"bash {fake.as_posix()}", DEPLOY_SLEEP_CMD=f"bash {stub.as_posix()}", SLEEP_LOG=log.as_posix())
    subprocess.run([BASH, SCRIPT.as_posix(), "--env", "x"], env=env, capture_output=True, text=True)
    assert log.read_text().split() == ["sleep", "30", "sleep", "60", "sleep", "120", "sleep", "240", "sleep", "480"]


@pytest.mark.skipif(BASH is None, reason="bash not available")
@pytest.mark.parametrize("msg", ["Authentication error [code: 10000] status 403", "HTTP 401 Unauthorized", "Bad Request status: 400"])
def test_4xx_fails_at_once(tmp_path, msg):
    rc, n, err = _run(tmp_path, 99, msg)
    assert (rc, n) == (1, 1)
    assert "not retrying" in err


@pytest.mark.skipif(BASH is None, reason="bash not available")
@pytest.mark.parametrize("msg", ["fetch failed: ECONNRESET", "Bad Gateway", "request to https://api.cloudflare.com failed, reason: ETIMEDOUT"])
def test_network_errors_and_5xx_are_retried(tmp_path, msg):
    assert _run(tmp_path, 2, msg)[:2] == (0, 2)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_unrecognised_failure_is_not_retried(tmp_path):
    rc, n, _ = _run(tmp_path, 99, "Could not resolve entry-point")
    assert (rc, n) == (1, 1)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_refuses_to_deploy_a_local_launch_preview(tmp_path):
    """scripts/glasgow_preview_build.sh writes dist/.launch-preview (noindex OFF build); the deploy script must refuse it."""
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / ".launch-preview").write_text("x")
    marker = tmp_path / "ran"
    env = dict(os.environ, DEPLOY_RETRY_PAUSE="0", INDEXNOW_DELAY="0", DEPLOY_CMD=f"touch {marker.as_posix()}")
    r = subprocess.run([BASH, SCRIPT.as_posix(), "--env", "glasgow"], env=env, capture_output=True, text=True, cwd=tmp_path)
    assert r.returncode == 4
    assert "launch preview" in r.stderr
    assert not marker.exists()
