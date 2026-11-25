"""QA build.battery-lock (owner 2026-11-25): one battery at a time, and an aborted battery leaves nothing running.

Born from 2026-11-25: a battery stopped from its caller lived on as an orphan and built into the same site/dist as the next
battery, which went red (a prerender chunk vanished mid-build in two towns). scripts/battery.sh now takes a lock file with the
PIDs of its supervisor and its body, refuses (exit 3) while either lives, removes a lock left by dead processes, and on
INT/TERM/HUP or a vanished caller kills the body's whole process tree (Windows trees via taskkill /T).

BATTERY_LOCK points each test at its own lock file (the real battery running these tests holds scratch_tmp/battery.lock) and
BATTERY_BODY replaces the steps with a small command. Before the fix battery.sh ignored both, ran every step and these fail."""
import os
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ROOT_UP = str(ROOT)[0].upper() + str(ROOT)[1:]  # QA build.lowercase-drive: never from "c:\"
LONG_NODE_JS = "require('fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n"


@pytest.fixture(autouse=True)
def _never_start_a_real_battery():
    """2026-11-25: run against a battery.sh without BATTERY_BODY, each test started a REAL battery, whose pytest ran these tests
    again, and so on (dozens of nested batteries before they were killed). So: fail before spawning anything unless battery.sh
    still honours both variables. The pytest-in-battery step itself is not affected: it never reaches a nested real battery."""
    script = (ROOT / "scripts" / "battery.sh").read_text(encoding="utf-8")
    assert '"$BATTERY_BODY"' in script and "BATTERY_LOCK:-" in script, \
        "battery.sh no longer honours BATTERY_BODY/BATTERY_LOCK; refusing to start it from a test (it would run itself recursively)"


def env(lock: Path, body: str) -> dict:
    return {**os.environ, "BATTERY_LOCK": lock.as_posix(), "BATTERY_BODY": body}


def battery(lock: Path, body: str, log: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "scripts/battery.sh", log.as_posix()], cwd=ROOT_UP, env=env(lock, body),
                          capture_output=True, text=True, encoding="utf-8", timeout=60)


def bash(cmd: str) -> str:
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=30).stdout.strip()


def alive(pid: int) -> bool:
    """A process id as the process itself reports it (process.pid: the Windows PID on Windows)."""
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def wait_for(cond, seconds: float = 20) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.25)
    return cond()


def test_exit_code_passes_through_and_the_lock_is_released(tmp_path):
    lock = tmp_path / "b.lock"
    r = battery(lock, "echo body-ran; exit 7", tmp_path / "log")
    assert r.returncode == 7 and "body-ran" in r.stdout, (r.stdout, r.stderr)
    assert not lock.exists()


def test_refuses_while_another_battery_lives(tmp_path):
    lock = tmp_path / "b.lock"
    holder = bash("sleep 60 > /dev/null 2>&1 & echo $!")  # a live process (bash PID) standing in for a running battery
    try:
        lock.write_text(f"{holder} \n", encoding="utf-8")
        r = battery(lock, "echo body-ran", tmp_path / "log")
        assert r.returncode == 3 and "kör redan" in r.stderr and holder in r.stderr, (r.stdout, r.stderr)
        assert "body-ran" not in r.stdout
        assert lock.read_text(encoding="utf-8").split()[0] == holder  # the other battery's lock is left alone
    finally:
        bash(f"kill {holder}")


def test_a_lock_from_a_dead_process_is_removed(tmp_path):
    lock = tmp_path / "b.lock"
    dead = bash("sleep 0 & p=$!; wait $p; echo $p")
    lock.write_text(f"{dead} 999999\n", encoding="utf-8")
    r = battery(lock, "echo body-ran", tmp_path / "log")
    assert r.returncode == 0 and "body-ran" in r.stdout, (r.stdout, r.stderr)
    assert "gammalt lås" in r.stderr and not lock.exists()


def _start_with_tree(tmp_path: Path, launcher: list[str]):
    lock, pidfile, script = tmp_path / "b.lock", tmp_path / "node.pid", tmp_path / "long.js"
    script.write_text(LONG_NODE_JS, encoding="utf-8")
    # body -> bash -> node: the node process is a grandchild of the body, the level the 2026-11-25 orphan kept running at.
    body = f"bash -c 'node {script.as_posix()} {pidfile.as_posix()}; echo after-node'; echo after-inner-bash"
    proc = subprocess.Popen(launcher, cwd=ROOT_UP, env=env(lock, body), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8")
    assert wait_for(lambda: pidfile.exists() and pidfile.read_text().strip() != ""), "the body's node never started"
    assert wait_for(lambda: lock.exists() and len(lock.read_text().split()) >= 2), "the lock never got the body's PID"
    return proc, lock, int(pidfile.read_text()), lock.read_text().split()[0]


def test_a_signal_kills_the_whole_tree(tmp_path):
    proc, lock, node_pid, supervisor = _start_with_tree(tmp_path, ["bash", "scripts/battery.sh", (tmp_path / "log").as_posix()])
    try:
        assert alive(node_pid)
        bash(f"kill -TERM {supervisor}")
        out, err = proc.communicate(timeout=30)
        assert proc.returncode == 143 and "AVBRUTET (signal TERM)" in err, (out, err)
        assert "after-node" not in out and "after-inner-bash" not in out
        assert wait_for(lambda: not alive(node_pid), 10), f"node {node_pid} (grandchild of the body) still runs"
        assert not lock.exists()
    finally:
        if proc.poll() is None:
            proc.kill()


def test_a_vanished_caller_kills_the_whole_tree(tmp_path):
    """The 2026-11-25 case: the process that started the battery is killed outright and never signals it."""
    caller_pid, sleep_pid = tmp_path / "caller.pid", tmp_path / "sleep.pid"
    launcher = ["bash", "-c", f"echo $$ > {caller_pid.as_posix()}; bash scripts/battery.sh {(tmp_path / 'log').as_posix()} & "
                              f"sleep 600 & echo $! > {sleep_pid.as_posix()}; wait"]
    proc, lock, node_pid, _ = _start_with_tree(tmp_path, launcher)
    try:
        bash(f"kill -KILL {caller_pid.read_text().strip()}")
        assert wait_for(lambda: not lock.exists(), 15), "the battery did not notice its caller was gone"
        assert wait_for(lambda: not alive(node_pid), 10), f"node {node_pid} still runs after the caller vanished"
    finally:
        bash(f"kill {sleep_pid.read_text().strip()} 2>/dev/null")
        if proc.poll() is None:
            proc.kill()
