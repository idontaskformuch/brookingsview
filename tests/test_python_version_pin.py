"""Local pytest and CI must run the same Python (CI was red 2026-11-05..06 because a fixture only Python 3.14 read; CI is 3.12)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
WORKFLOWS = sorted((ROOT / ".github" / "workflows").glob("*.yml"))


def test_python_version_file_is_pinned_to_3_12():
    assert (ROOT / ".python-version").read_text(encoding="utf-8").strip() == "3.12"


def test_every_workflow_reads_the_pinned_version_instead_of_naming_one():
    for wf in WORKFLOWS:
        text = wf.read_text(encoding="utf-8")
        assert not re.search(r"^\s*python-version:", text, re.M), f"{wf.name} names its own Python version"
        if "actions/setup-python" in text:
            assert "python-version-file: .python-version" in text, wf.name


def test_the_interpreter_running_these_tests_is_the_pinned_one():
    # Fails on purpose when someone runs pytest on another Python: use `.venv/Scripts/python -m pytest` (see .claude/state.md).
    assert f"{sys.version_info.major}.{sys.version_info.minor}" == "3.12"
