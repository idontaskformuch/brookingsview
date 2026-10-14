from datetime import datetime, timezone

from scripts.find_duplicate_meetings import find_duplicate_candidates


def _meeting(id_, body, day, event_id, event_time=None, event_location=None):
    return {
        "id": id_,
        "body": body,
        "meeting_date": datetime(day.year, day.month, day.day, tzinfo=timezone.utc),
        "raw_data": {"EventId": event_id, "EventTime": event_time, "EventLocation": event_location},
    }


def test_same_body_and_day_but_different_time_and_location_is_not_a_duplicate():
    """Confirmed live 2026-10-14 (round 6): Brookings' "duplicate (body, day)"
    groups were overwhelmingly Legistar Notice of Quorum postings -- a
    regular meeting plus a same-day notice at a different time/venue, e.g.
    Historic Preservation Commission 2026-10-10 (EventId 3841, 11am
    Children's Museum vs 3842, 1:30pm Cubby's)."""
    day = datetime(2026, 10, 10, tzinfo=timezone.utc).date()
    rows = [
        _meeting(13999, "Historic Preservation Commission", day, 3841, "11:00 AM", "Children's Museum"),
        _meeting(14000, "Historic Preservation Commission", day, 3842, "1:30 PM", "Cubby's"),
    ]

    result = find_duplicate_candidates(rows)

    assert result["true_duplicates"] == []
    assert len(result["not_duplicates"]) == 2
    event_ids = {entry["event_ids"][0] for entry in result["not_duplicates"]}
    assert event_ids == {3841, 3842}


def test_same_body_day_time_and_location_is_flagged_as_a_true_duplicate():
    """A real re-posted duplicate -- same body, day, EventTime AND
    EventLocation, just two different EventIds (e.g. a corrected re-post)."""
    day = datetime(2026, 11, 3, tzinfo=timezone.utc).date()
    rows = [
        _meeting(1, "City Council", day, 4001, "6:00 PM", "Council Chambers"),
        _meeting(2, "City Council", day, 4002, "6:00 PM", "Council Chambers"),
    ]

    result = find_duplicate_candidates(rows)

    assert len(result["true_duplicates"]) == 1
    dup = result["true_duplicates"][0]
    assert sorted(dup["meeting_ids"]) == [1, 2]
    assert sorted(dup["event_ids"]) == [4001, 4002]
    assert result["not_duplicates"] == []


def test_same_body_and_day_missing_time_and_location_is_not_auto_flagged():
    """Can't confirm or rule out without EventTime/EventLocation -- must
    never be silently marked a duplicate just because (body, day) match."""
    day = datetime(2026, 11, 5, tzinfo=timezone.utc).date()
    rows = [
        _meeting(10, "Some Commission", day, 5001),
        _meeting(11, "Some Commission", day, 5002),
    ]

    result = find_duplicate_candidates(rows)

    assert result["true_duplicates"] == []
    assert len(result["not_duplicates"]) == 1
    assert "missing" in result["not_duplicates"][0]["reason"]


def test_single_meeting_for_a_body_and_day_is_not_reported_at_all():
    day = datetime(2026, 11, 6, tzinfo=timezone.utc).date()
    rows = [_meeting(20, "Planning Commission", day, 6001, "5:00 PM", "City Hall")]

    result = find_duplicate_candidates(rows)

    assert result["true_duplicates"] == []
    assert result["not_duplicates"] == []


def test_different_bodies_on_the_same_day_are_never_grouped_together():
    day = datetime(2026, 11, 7, tzinfo=timezone.utc).date()
    rows = [
        _meeting(30, "City Council", day, 7001, "6:00 PM", "Council Chambers"),
        _meeting(31, "Planning Commission", day, 7002, "6:00 PM", "Council Chambers"),
    ]

    result = find_duplicate_candidates(rows)

    assert result["true_duplicates"] == []
    assert result["not_duplicates"] == []
