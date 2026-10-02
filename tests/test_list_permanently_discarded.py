"""Tests for scripts/list_permanently_discarded.py's pure --since parsing --
the DB-querying main() isn't unit tested directly, same convention as the
rest of this codebase (see tests/test_check_deployed_content.py's own
docstring)."""
from datetime import timedelta

import pytest

from scripts.list_permanently_discarded import _parse_since


def test_parse_since_days():
    assert _parse_since("7d") == timedelta(days=7)


def test_parse_since_hours():
    assert _parse_since("48h") == timedelta(hours=48)


def test_parse_since_rejects_bad_format():
    with pytest.raises(Exception):
        _parse_since("a week")
