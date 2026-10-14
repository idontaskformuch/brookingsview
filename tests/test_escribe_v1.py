"""Coverage for scrapers/parsers/escribe_v1.py's date parsing -- specifically
the 2026-09-30 timezone fix: eSCRIBE's StartDate ("YYYY/MM/DD HH:MM:SS") is
the venue's own local wall-clock time, never UTC. _parse_escribe_date() used
to return a naive datetime, which (confirmed live against Moreno Valley's
real data) got silently stored as if it were UTC -- an 18:00 Pacific meeting
ended up ~7 hours wrong. See db.ts's getNextMeeting()/formatMeetingWhen() for
the site-side half of this same bug family.
"""
import json
from datetime import datetime

import scrapers.parsers.escribe_v1 as escribe_v1
from scrapers.base_parser import FetchResult
from scrapers.parsers.escribe_v1 import EscribeParser, _parse_escribe_date


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


# --- content_hash stability (real 2026-10-13 bug: meetings 12940/13790) -----

def _minimal_meeting(meeting_id="353244f6-554c-479b-a191-fb3769005e7f", start_date="2026/09/24 18:00:00"):
    return {"ID": meeting_id, "MeetingName": "Planning Commission",
            "StartDate": start_date, "MeetingDocumentLink": []}


def _parse_one(meeting: dict) -> dict:
    parser = EscribeParser(
        {"town_id": "moreno_valley_ca", "timezone": "America/Los_Angeles"},
        {"base_url": "https://pub-example.escribemeetings.com"},
    )
    fetched = FetchResult(raw=json.dumps([meeting]).encode("utf-8"), content_type="application/json")
    return parser.parse(fetched)[0]


def test_content_hash_independent_of_date_parsing_logic(monkeypatch):
    """The real bug: a _parse_escribe_date fix changed what content_hash
    computed for the SAME real meeting (same eSCRIBE ID, same raw
    StartDate), because the hash used to be built from meeting_dt (the
    PARSED value) instead of the raw string -- ON CONFLICT never matched
    the existing row under its old hash, and a byte-identical second row
    got inserted. content_hash must stay identical no matter what
    _parse_escribe_date itself returns for the same raw input."""
    meeting = _minimal_meeting()
    rec_before = _parse_one(dict(meeting))
    # Stand-in for ANY future change to date-parsing behavior, not just the
    # real naive-vs-tz-aware one -- content_hash must not care either way.
    monkeypatch.setattr(escribe_v1, "_parse_escribe_date", lambda value, tzname: None)
    rec_after = _parse_one(dict(meeting))
    assert rec_before["content_hash"] == rec_after["content_hash"]


def test_content_hash_still_changes_for_a_genuinely_different_meeting():
    base = _parse_one(dict(_minimal_meeting()))
    different_id = _parse_one(dict(_minimal_meeting(meeting_id="a-different-guid")))
    different_date = _parse_one(dict(_minimal_meeting(start_date="2026/10/01 18:00:00")))
    assert base["content_hash"] != different_id["content_hash"]
    assert base["content_hash"] != different_date["content_hash"]
