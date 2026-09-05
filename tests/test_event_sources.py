"""Coverage for scrapers/event_sources.py's "ical" kind -- extracted verbatim
from scrapers/parsers/events.py during the Fas 3 del 1 source-registry
refactor (see baseline diff proving zero behavior change against real
Brookings/Moreno Valley feeds). No test file previously existed for this
fetch/parse logic; these lock in the quirks already found and fixed once so
a future edit to this module can't silently reintroduce them.
"""
from scrapers.event_sources import (
    EVENT_SOURCE_KINDS, _BAD_REFRESH_PROPS, _BLOB_SEPARATOR, _decode_ics,
    _extract_event_slugs, _parse_html_listing_ical, _parse_ical,
)


def _ics(body: str) -> bytes:
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + body + "END:VCALENDAR\r\n").encode()


def _vevent(uid: str, title: str, dtstart: str = "20260101T100000Z") -> str:
    return f"BEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:{title}\r\nDTSTART:{dtstart}\r\nEND:VEVENT\r\n"


def test_registry_has_ical_and_html_listing_ics_kinds():
    # "blocked"/"unconfirmed" are inert markers handled in events.py before
    # the registry is even consulted -- see event_sources.py's own comment.
    assert set(EVENT_SOURCE_KINDS) == {"ical", "html_listing_ics"}


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


# ---- "html_listing_ics" kind (ChamberMaster/GrowthZone, Fas 3 källjakt) ----

def test_extract_event_slugs_matches_events_and_bpnevents_variants():
    html = (
        '<a href="https://x.example.com/events/Details/first-slug-123?sourceTypeId=Hub">First</a>'
        '<a href="https://x.example.com/bpnevents/Details/second-slug-456?sourceTypeId=Hub">Second</a>'
    )
    assert _extract_event_slugs(html) == ["first-slug-123", "second-slug-456"]


def test_extract_event_slugs_deduplicates_preserving_first_seen_order():
    # a long-running event repeats once per day-cell in the calendar grid --
    # confirmed live 2026-09-05 (Military Affairs Banner Program appeared
    # dozens of times across a 7-month run).
    html = (
        '<a href="/events/Details/repeats-1?x=1">A</a>'
        '<a href="/events/Details/once-2?x=1">B</a>'
        '<a href="/events/Details/repeats-1?x=2">A again</a>'
    )
    assert _extract_event_slugs(html) == ["repeats-1", "once-2"]


def test_extract_event_slugs_handles_no_matches():
    assert _extract_event_slugs("<p>no events here</p>") == []


def test_parse_html_listing_ical_splits_and_parses_each_item():
    combined = _BLOB_SEPARATOR.join([
        b"slug-a\n" + _ics(_vevent("uid-a", "Event A")),
        b"slug-b\n" + _ics(_vevent("uid-b", "Event B")),
    ])
    records = _parse_html_listing_ical("chamber_business", combined)
    assert sorted(r["title"] for r in records) == ["Event A", "Event B"]
    assert all(r["source"] == "chamber_business" for r in records)


def test_parse_html_listing_ical_empty_blob_returns_no_records():
    assert _parse_html_listing_ical("chamber_business", b"") == []


def test_blob_separator_is_distinct_from_events_py_outer_separator():
    # Regression test for a real bug caught before shipping (Fas 3, del 2):
    # events.py's own outer multi-source fetch() combines independent blobs
    # with b"\n--EVENTSOURCE--\n", and its parse() falls back to splitting on
    # that exact literal when self._blobs isn't cached (e.g. reparsing a
    # saved snapshot in a fresh process). If this kind's OWN inner per-event
    # join reused that same separator, that fallback split would shred this
    # blob's inner boundaries too, silently corrupting reconstruction. They
    # must never be equal.
    from scrapers.event_sources import _BLOB_SEPARATOR as inner_separator
    outer_separator = b"\n--EVENTSOURCE--\n"
    assert inner_separator != outer_separator


def test_html_listing_ical_survives_outer_events_py_wrapping_roundtrip():
    # End-to-end version of the regression above: wrap this kind's combined
    # blob the exact way events.py's fetch() wraps every source's blob, then
    # reconstruct via the exact way its parse() does when self._blobs is
    # unavailable -- must recover the identical per-slug blob untouched.
    outer_separator = b"\n--EVENTSOURCE--\n"
    inner_combined = _BLOB_SEPARATOR.join([
        b"slug-a\n" + _ics(_vevent("uid-a", "Event A")),
        b"slug-b\n" + _ics(_vevent("uid-b", "Event B")),
    ])
    blobs = {"chamber_business": inner_combined, "library": _ics(_vevent("uid-c", "Event C"))}
    snapshot = outer_separator.join(name.encode() + b"\n" + blob for name, blob in blobs.items())

    reconstructed = {}
    for chunk in snapshot.split(outer_separator):
        name, _, blob = chunk.partition(b"\n")
        reconstructed[name.decode()] = blob

    assert reconstructed["chamber_business"] == inner_combined
    records = _parse_html_listing_ical("chamber_business", reconstructed["chamber_business"])
    assert sorted(r["title"] for r in records) == ["Event A", "Event B"]
