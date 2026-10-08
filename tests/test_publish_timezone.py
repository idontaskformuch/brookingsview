"""Regression tests for the FAS 2 site-wide timezone bug (see
ai_pipeline/publish.py:_fmt_hour_min/group_event_slots/group_recurring_events
and ai_pipeline/weekly.py:_clock) -- the class of bug this session found is
"reads .hour/.minute off a UTC-aware datetime with zero .astimezone() first",
which silently produces the wrong clock time and can even group an event
under the wrong calendar day. These tests fix a UTC instant that crosses
midnight in BOTH America/Chicago and America/Los_Angeles so a regression
would show up as a wrong hour, not just a wrong minute-level rounding.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ai_pipeline.publish import (
    _fmt_hour_min, build_source_url, build_title, extract_quorum_event, fmt_dt, fmt_time,
    group_event_slots, group_recurring_events, is_quorum_notice_only, slug_date,
)
from ai_pipeline.weekly import _clock

CHICAGO = ZoneInfo("America/Chicago")
LOS_ANGELES = ZoneInfo("America/Los_Angeles")

# 2026-08-15 05:30 UTC = 2026-08-15 00:30 Central (still Aug 15) but
# 2026-08-14 22:30 Pacific (Aug 14, the previous LOCAL calendar day) --
# exactly the cross-midnight case that silently broke without tz conversion.
CROSSING_INSTANT = datetime(2026, 8, 15, 5, 30, tzinfo=timezone.utc)


def test_fmt_hour_min_without_tz_is_raw_utc():
    # documents the pre-fix behavior (no tz given) so a future caller can't
    # accidentally assume this ever localizes on its own
    assert _fmt_hour_min(CROSSING_INSTANT) == "5:30 AM"


def test_fmt_hour_min_localizes_to_chicago():
    assert _fmt_hour_min(CROSSING_INSTANT, CHICAGO) == "12:30 AM"


def test_fmt_hour_min_localizes_to_los_angeles():
    assert _fmt_hour_min(CROSSING_INSTANT, LOS_ANGELES) == "10:30 PM"


def test_fmt_time_threads_tz_through():
    assert fmt_time(CROSSING_INSTANT, LOS_ANGELES) == "10:30 PM"


def test_fmt_dt_localizes_both_date_and_time_when_tz_given():
    # Events correctness Phase 1 (2026-10-08): this test used to assert the
    # OPPOSITE -- that the date half stayed pinned to the UTC calendar day
    # ("Aug 15") while only the clock-time half localized. That was the bug,
    # not a deliberate rule: CROSSING_INSTANT (2026-08-15 05:30 UTC) is
    # 2026-08-14 22:30 in Los Angeles, so a reader was shown "Aug 15 ...
    # 10:30 PM" for an event that, locally, happened on Aug 14 at night --
    # internally inconsistent, and written straight into published article
    # text via _localize_datetime_fields() and into group_recurring_events()'s
    # series_dates. meeting_date-style bare-calendar-day values still never
    # reach this path with a tz at all (build_title() uses its own
    # _meeting_date_title_part(), never fmt_dt(), for exactly that reason --
    # see fmt_dt's own docstring).
    la_text = fmt_dt(CROSSING_INSTANT, with_time=True, tz=LOS_ANGELES)
    assert "Aug 14" in la_text
    assert "Aug 15" not in la_text
    assert "10:30 PM" in la_text


def test_fmt_dt_localizes_date_the_other_direction_too():
    # Same bug, opposite crossing direction: a 23:30 Central event is
    # 04:30 UTC the NEXT calendar day, and the original live symptom this
    # whole phase traces back to ("evening events show a date one day
    # off") -- a late-evening local event must still show its OWN local
    # date, not the later UTC one.
    instant = datetime(2026, 10, 2, 4, 30, tzinfo=timezone.utc)  # Oct 1, 23:30 Central
    text = fmt_dt(instant, with_time=True, tz=CHICAGO)
    assert "Oct 1" in text
    assert "Oct 2" not in text
    assert "11:30 PM" in text


def test_group_event_slots_groups_by_localized_day_not_utc_day():
    # a 22:30 Pacific event (06:00 UTC the NEXT day) must group under its
    # Pacific calendar day, not the UTC one -- this is the group_event_slots
    # bug that predates the fix (day computed off starts.date() pre-conversion)
    late_event = {
        "id": 1, "title": "Movie Night", "source": "library",
        "starts_at": datetime(2026, 8, 15, 6, 0, tzinfo=timezone.utc),  # Aug 14, 23:00 PT
    }
    grouped = group_event_slots([late_event], LOS_ANGELES)
    assert len(grouped) == 1


def test_weekly_clock_localizes_to_chicago():
    assert _clock(CROSSING_INSTANT, CHICAGO) == "12:30 AM"


def test_weekly_clock_localizes_to_los_angeles():
    assert _clock(CROSSING_INSTANT, LOS_ANGELES) == "10:30 PM"


def test_group_recurring_events_series_dates_localized():
    base = {"title": "Toddler Time", "source": "library", "starts_at": CROSSING_INSTANT}
    members = [
        {**base, "id": i, "starts_at": CROSSING_INSTANT.replace(day=15 + i)}
        for i in range(4)
    ]
    [series] = group_recurring_events(members, LOS_ANGELES)
    assert series["is_recurring_series"] is True
    assert series["series_count"] == 4
    # every listed date/time in the series must reflect Pacific, not raw UTC
    assert all("10:30 PM" in d or "PM" in d or "AM" in d for d in series["series_dates"])
    assert "10:30 PM" in series["series_dates"][0]


def test_slug_date_never_shifts_with_timezone():
    # SEO Fas 5's dated meeting slugs (see NEEDS-HUMAN-REVIEW.md) -- same
    # rule as fmt_dt's date half above: meeting_date is a bare calendar
    # date at UTC midnight, so the slug's date part must read the raw UTC
    # calendar day directly, never reinterpret it through a timezone.
    midnight_utc = datetime(2026, 8, 25, 0, 0, tzinfo=timezone.utc)
    assert slug_date(midnight_utc) == "2026-08-25"


def test_slug_date_accepts_iso_string():
    assert slug_date("2026-08-25T00:00:00Z") == "2026-08-25"


def test_slug_date_none_for_missing_value():
    assert slug_date(None) is None


def test_slug_date_stays_bare_for_legistar_towns():
    # Oct 1, 2026 00:00 UTC is a bare calendar date -- no cfg, and with a
    # meetings_have_time: false cfg, must read "2026-10-01", never shifted.
    midnight_utc = datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)
    assert slug_date(midnight_utc) == "2026-10-01"
    assert slug_date(midnight_utc, BROOKINGS_CFG) == "2026-10-01"


# Notice-of-quorum detection -- real live incident found 2026-10-01: a
# Brookings Solar Ribbon Cutting Ceremony was published as a "City
# Council" meeting story ("City Council — Thu, Oct 1, 2026") because
# build_title() never distinguished a real meeting from a Legistar
# "Notice of Quorum" posting (SDCL 1-25-1.1) -- 24 of Brookings' published
# meeting stories turned out to be this.

# Real, verbatim agenda_text from meeting id 12458 (the actual ribbon-cutting).
REAL_QUORUM_NOTICE_AGENDA = (
    "The City of Brookings is committed to providing a high quality of life for its citizens and "
    "fostering a diverse economic base through innovative thinking, strategic planning, and "
    "proactive, fiscally responsible municipal management.\n"
    "Notice of Quorum\n"
    "It is possible that at least four (4) City Council and five (5) Planning Commission members "
    "may be present for the Brookings Solar Ribbon Cutting Ceremony to be held on Thursday, "
    "October 1, 2026, from 2:00 pm – 4:00 pm.  Though a majority of City Council and Planning "
    "Commission members may be present, no official city business will be acted upon. This notice "
    "constitutes sufficient public notice according to SD Codified Law 1-25-1.1."
)

# Real, verbatim agenda_text excerpt from a genuine meeting (Brookings County
# Outdoor Adventure Center Advisory Board) whose own agenda routinely
# includes a "determination of a quorum" procedural step -- must NOT be
# misclassified as a notice-only posting.
REAL_GENUINE_MEETING_AGENDA = (
    "Any requested action items must be scheduled for a future meeting date.\n"
    "3. Determination of a quorum\n"
    "Five board members must be present for a quorum\n"
    "4. Approval of Agenda\n"
    "Action: Motion to approve, Comments, Voice Vote"
)


def test_is_quorum_notice_only_flags_real_notice():
    assert is_quorum_notice_only({"agenda_text": REAL_QUORUM_NOTICE_AGENDA}) is True


def test_is_quorum_notice_only_false_for_genuine_meeting_mentioning_quorum():
    assert is_quorum_notice_only({"agenda_text": REAL_GENUINE_MEETING_AGENDA}) is False


def test_is_quorum_notice_only_false_for_missing_agenda():
    assert is_quorum_notice_only({}) is False


def test_extract_quorum_event_from_real_notice():
    assert extract_quorum_event(REAL_QUORUM_NOTICE_AGENDA) == "Brookings Solar Ribbon Cutting Ceremony"


def test_extract_quorum_event_handles_varied_phrasing():
    # Real variant (meeting id 11875): "may be present to {event} on {weekday}".
    text = ("Notice of Quorum\nIt is possible that at least four (4) City Council members may be "
            "present to Chalk the Walk for Suicide Prevention Month on Tuesday, September 8, 2026.")
    assert extract_quorum_event(text) == "Chalk the Walk for Suicide Prevention Month"


def test_build_title_labels_quorum_notice_instead_of_meeting():
    row = {
        "body": "City Council",
        "meeting_date": datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc),
        "raw_data": {"agenda_text": REAL_QUORUM_NOTICE_AGENDA},
    }
    assert build_title("meetings", row, BROOKINGS_CFG) == "Notice: possible quorum — Brookings Solar Ribbon Cutting Ceremony"


def test_build_title_still_builds_normal_title_for_genuine_meeting():
    row = {
        "body": "City Council",
        "meeting_date": datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc),
        "raw_data": {"agenda_text": "1. Call to Order\n2. Approval of Minutes\n3. Public Hearing on rezoning"},
    }
    assert build_title("meetings", row, BROOKINGS_CFG) == "City Council — Thu, Oct 1, 2026"


def test_slug_date_localizes_for_real_timestamp_towns():
    # Same real example as the build_title() tests above (meeting id
    # 11337): 2026-10-14T00:00:00Z is Tue Oct 13, 6 PM Denver -- a NEW
    # slug for this meeting must use the correct local date, "2026-10-13",
    # not "2026-10-14".
    real_instant = datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)
    assert slug_date(real_instant, BROOMFIELD_CFG) == "2026-10-13"


def test_build_source_url_rejects_sandbox_agenda_url():
    # Broomfield Handoff (2026-09-30), Issue 2: AgendaLink's own API returns
    # agendaUrl values on sandbox.agendalink.app -- confirmed live never a
    # confirmed production host. Never publish it as a story's citable
    # source_url (site/src/lib/db.ts's isSandboxUrl() is the same rule on
    # the render side, kept in sync).
    row = {"agenda_url": "https://sandbox.agendalink.app/engage/broomfield/abc123"}
    assert build_source_url("meetings", row) is None


def test_build_source_url_keeps_real_agenda_url():
    row = {"agenda_url": "https://cityofbrookings.legistar.com/MeetingDetail.aspx?ID=123"}
    assert build_source_url("meetings", row) == "https://cityofbrookings.legistar.com/MeetingDetail.aspx?ID=123"


def test_build_source_url_none_for_missing_agenda_url():
    assert build_source_url("meetings", {}) is None


# build_title()'s meeting-date portion -- real live bug found 2026-10-01
# during final verification: a Broomfield story title read "City Council
# Regular Meeting — Wed, Oct 14, 2026" for a meeting actually on Tuesday
# evening Denver time, because the date was read from the raw UTC instant
# with no tz conversion -- the exact same bug class as formatMeetingDate()
# on the site-display side, just unfixed on the Python/title side until now.

BROOKINGS_CFG = {"timezone": "America/Chicago", "data_sources": {"city_meetings": {"meetings_have_time": False}}}
BROOMFIELD_CFG = {"timezone": "America/Denver", "data_sources": {"city_meetings": {"meetings_have_time": True}}}


def test_build_title_meeting_date_stays_bare_for_legistar_towns():
    # Oct 1, 2026 00:00 UTC is a bare calendar date (Legistar has no real
    # time) -- must read as "Thu, Oct 1", never tz-shifted to Sep 30.
    row = {"body": "City Council", "meeting_date": datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)}
    assert build_title("meetings", row, BROOKINGS_CFG) == "City Council — Thu, Oct 1, 2026"


def test_build_title_meeting_date_converts_for_real_timestamp_towns():
    # Real example (meeting id 11337): 2026-10-14T00:00:00Z is Tue Oct 13,
    # 6:00 PM Denver -- the title's date must say Tuesday Oct 13, not
    # Wednesday Oct 14.
    row = {"body": "City Council Regular Meeting", "meeting_date": datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)}
    assert build_title("meetings", row, BROOMFIELD_CFG) == "City Council Regular Meeting — Tue, Oct 13, 2026"


def test_build_title_defaults_to_bare_date_when_cfg_missing():
    row = {"body": "City Council", "meeting_date": datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)}
    assert build_title("meetings", row, None) == "City Council — Thu, Oct 1, 2026"
