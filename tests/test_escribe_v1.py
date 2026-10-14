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


# --- document-fetch visibility (2026-10-14: per-document failures used to
# only reach a print(), never scrape_runs -- see db.finish_run()'s own
# docstring and scrapers/runner.py's status downgrade) ---------------------

class _FakeResponse:
    def __init__(self, status_code: int, json_body=None, content: bytes = b""):
        self.status_code = status_code
        self._json_body = json_body
        self.content = content
        self.text = ""

    def json(self):
        return self._json_body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _parser():
    return EscribeParser(
        {"town_id": "moreno_valley_ca", "timezone": "America/Los_Angeles"},
        {"base_url": "https://pub-example.escribemeetings.com"},
    )


def _calendar_meeting_with_all_three_docs():
    return {
        "ID": "m1", "MeetingName": "City Council", "StartDate": "2026/09/24 18:00:00",
        "HasAgenda": True,
        "MeetingDocumentLink": [
            {"Type": "Agenda", "Format": "HTML", "Url": "/Meeting.aspx?Id=m1&Agenda=Agenda"},
            {"Type": "PostMinutes", "Url": "/FileStream.ashx?DocumentId=minutes1"},
            {"Type": "AdditionalDocuments", "Title": "ACTION SUMMARY",
             "Url": "/FileStream.ashx?DocumentId=action1"},
        ],
    }


def test_fetch_counts_all_three_document_types_as_failed_when_every_request_errors(monkeypatch):
    """Real-world shape (Moreno Valley, 2026-10-14 investigation): the
    calendar call itself succeeds (200), but every per-document request --
    agenda, minutes, action summary -- hits a wall (here: a non-200
    response, standing in for the real Cloudflare challenge). docs_attempted
    must equal docs_failed so runner.py can downgrade status to 'degraded'
    instead of 'ok'."""
    meeting = _calendar_meeting_with_all_three_docs()

    def fake_post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(200, json_body={"d": [meeting]})

    def fake_get(url, headers=None, timeout=None):
        return _FakeResponse(403)  # every document fetch blocked

    monkeypatch.setattr("scrapers.parsers.escribe_v1.requests.post", fake_post)
    monkeypatch.setattr("scrapers.parsers.escribe_v1.requests.get", fake_get)

    result = _parser().fetch()

    assert result.docs_attempted == 3
    assert result.docs_failed == 3
    assert result.docs_last_error is not None and "m1" in result.docs_last_error


def test_fetch_counts_zero_documents_when_no_meeting_has_any(monkeypatch):
    meeting = {"ID": "m2", "MeetingName": "Planning Commission",
               "StartDate": "2026/09/24 18:00:00", "HasAgenda": False,
               "MeetingDocumentLink": []}

    monkeypatch.setattr(
        "scrapers.parsers.escribe_v1.requests.post",
        lambda url, headers=None, json=None, timeout=None: _FakeResponse(200, json_body={"d": [meeting]}),
    )

    result = _parser().fetch()

    assert result.docs_attempted == 0
    assert result.docs_failed == 0
    assert result.docs_last_error is None


def test_fetch_partial_document_failure_is_counted_not_hidden(monkeypatch):
    """Agenda fetch succeeds, minutes and action summary both fail --
    docs_failed must reflect exactly 2 of 3, not 0 and not 3."""
    meeting = _calendar_meeting_with_all_three_docs()

    def fake_get(url, headers=None, timeout=None):
        if "Agenda" in url:
            return _FakeResponse(200, content=b"")
        return _FakeResponse(500)

    monkeypatch.setattr(
        "scrapers.parsers.escribe_v1.requests.post",
        lambda url, headers=None, json=None, timeout=None: _FakeResponse(200, json_body={"d": [meeting]}),
    )
    monkeypatch.setattr("scrapers.parsers.escribe_v1.requests.get", fake_get)

    result = _parser().fetch()

    assert result.docs_attempted == 3
    assert result.docs_failed == 2
