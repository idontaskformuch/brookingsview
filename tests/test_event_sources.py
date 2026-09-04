"""Coverage for scrapers/event_sources.py's "ical" kind -- extracted verbatim
from scrapers/parsers/events.py during the Fas 3 del 1 source-registry
refactor (see baseline diff proving zero behavior change against real
Brookings/Moreno Valley feeds). No test file previously existed for this
fetch/parse logic; these lock in the quirks already found and fixed once so
a future edit to this module can't silently reintroduce them.
"""
from scrapers.event_sources import (
    EVENT_SOURCE_KINDS, _BAD_REFRESH_PROPS, _decode_ics, _parse_ical,
)


def _ics(body: str) -> bytes:
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + body + "END:VCALENDAR\r\n").encode()


def test_registry_only_has_ical_kind():
    # "blocked"/"unconfirmed" are inert markers handled in events.py before
    # the registry is even consulted -- see event_sources.py's own comment.
    assert set(EVENT_SOURCE_KINDS) == {"ical"}


def test_decode_ics_prefers_utf8():
    assert _decode_ics("src", "café".encode("utf-8")) == "café"


def test_decode_ics_falls_back_to_cp1252():
    # a library staffer pasting Windows-authored text into a calendar tool
    # that doesn't re-encode it -- 0xe9 alone is not valid utf-8.
    raw = "café".encode("cp1252")
    assert _decode_ics("src", raw) == "café"


def test_decode_ics_lossy_fallback_when_neither_works(capsys):
    # 0x81 is undefined in cp1252 (and invalid as a lone utf-8 byte) -- a
    # byte sequence that genuinely fails both encodings.
    raw = b"broken\x81tail"
    result = _decode_ics("src", raw)
    assert "�" in result
    assert "kunde inte avkoda" in capsys.readouterr().out


def test_bad_refresh_props_stripped():
    # Tockify's REFRESH-INTERVAL:P15M is missing RFC 5545's "T" duration
    # designator -- icalendar parses "P15M" as 15 MONTHS and rejects it,
    # throwing for the whole document. Confirmed live 2026-07-23.
    raw = _ics("REFRESH-INTERVAL:P15M\r\nX-PUBLISHED-TTL:P15M\r\n")
    stripped = _BAD_REFRESH_PROPS.sub(b"", raw)
    assert b"REFRESH-INTERVAL" not in stripped
    assert b"X-PUBLISHED-TTL" not in stripped


def test_parse_ical_extracts_basic_event():
    raw = _ics(
        "BEGIN:VEVENT\r\n"
        "UID:test-uid-1\r\n"
        "SUMMARY:Test Event\r\n"
        "DTSTART:20260101T100000Z\r\n"
        "DTEND:20260101T110000Z\r\n"
        "LOCATION:Test Venue\r\n"
        "DESCRIPTION:Test description\r\n"
        "END:VEVENT\r\n"
    )
    records = _parse_ical("library", raw)
    assert len(records) == 1
    r = records[0]
    assert r["title"] == "Test Event"
    assert r["venue"] == "Test Venue"
    assert r["source"] == "library"
    assert r["starts_at"] == "2026-01-01T10:00:00+00:00"
    assert r["raw_data"]["uid"] == "test-uid-1"


def test_parse_ical_survives_malformed_refresh_interval():
    # the actual live Tockify bug -- REFRESH-INTERVAL:P15M at the calendar
    # level must not crash parsing of the real VEVENTs alongside it.
    raw = _ics(
        "REFRESH-INTERVAL:P15M\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:test-uid-2\r\n"
        "SUMMARY:Survives Bad Refresh\r\n"
        "DTSTART:20260101T100000Z\r\n"
        "END:VEVENT\r\n"
    )
    records = _parse_ical("city_events", raw)
    assert len(records) == 1
    assert records[0]["title"] == "Survives Bad Refresh"


def test_parse_ical_skips_event_with_suspicious_title():
    raw = _ics(
        "BEGIN:VEVENT\r\n"
        "UID:bad-title\r\n"
        "SUMMARY:Garbled ��� Title\r\n"
        "DTSTART:20260101T100000Z\r\n"
        "END:VEVENT\r\n"
    )
    assert _parse_ical("library", raw) == []


def test_parse_ical_nulls_suspicious_location_and_description_only():
    raw = _ics(
        "BEGIN:VEVENT\r\n"
        "UID:bad-fields\r\n"
        "SUMMARY:Clean Title\r\n"
        "DTSTART:20260101T100000Z\r\n"
        "LOCATION:Garbled ��� Place\r\n"
        "DESCRIPTION:Garbled ��� Text\r\n"
        "END:VEVENT\r\n"
    )
    records = _parse_ical("chamber", raw)
    assert len(records) == 1
    r = records[0]
    assert r["title"] == "Clean Title"
    assert r["venue"] is None
    assert r["raw_data"]["description"] is None


def test_parse_ical_skips_event_with_no_title():
    raw = _ics("BEGIN:VEVENT\r\nUID:no-title\r\nDTSTART:20260101T100000Z\r\nEND:VEVENT\r\n")
    assert _parse_ical("library", raw) == []


def test_parse_ical_empty_calendar_returns_no_records():
    assert _parse_ical("library", _ics("")) == []


def test_parse_ical_malformed_calendar_does_not_raise():
    assert _parse_ical("library", b"not a real calendar at all") == []
