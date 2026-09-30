"""Coverage for scrapers/parsers/escribe_v1.py's date parsing -- specifically
the 2026-09-30 timezone fix: eSCRIBE's StartDate ("YYYY/MM/DD HH:MM:SS") is
the venue's own local wall-clock time, never UTC. _parse_escribe_date() used
to return a naive datetime, which (confirmed live against Moreno Valley's
real data) got silently stored as if it were UTC -- an 18:00 Pacific meeting
ended up ~7 hours wrong. See db.ts's getNextMeeting()/formatMeetingWhen() for
the site-side half of this same bug family.
"""
from datetime import datetime

from scrapers.parsers.escribe_v1 import _parse_escribe_date


def test_parse_escribe_date_localizes_to_town_timezone():
    dt = _parse_escribe_date("2026/09/15 18:00:00", "America/Los_Angeles")
    assert dt is not None
    assert dt.isoformat() == "2026-09-15T18:00:00-07:00"


def test_parse_escribe_date_none_for_missing_value():
    assert _parse_escribe_date(None, "America/Los_Angeles") is None


def test_parse_escribe_date_none_for_malformed_value():
    assert _parse_escribe_date("not a date", "America/Los_Angeles") is None


def test_parse_escribe_date_respects_dst_boundary():
    # 2026-11-01 is after the US DST-end date -- PST (UTC-8), not PDT (UTC-7).
    dt = _parse_escribe_date("2026/11/02 18:00:00", "America/Los_Angeles")
    assert dt is not None
    assert dt.isoformat() == "2026-11-02T18:00:00-08:00"
    assert isinstance(dt, datetime) and dt.tzinfo is not None
