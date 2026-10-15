"""Phase 7 ('Decisions'), AgendaLink/Broomfield -- see
ai_pipeline/meeting_decisions_agendalink.py's own module docstring for the
real, live-verified Broomfield cases these encode (meeting 11344, 2026-09-08
Regular Meeting: Palisade Park Chipotle Mexican Grill resolutions and the
EV Charging ordinance)."""
from unittest.mock import MagicMock

from ai_pipeline.meeting_decisions_agendalink import (
    FETCH_WINDOW_DAYS, final_motion, find_candidate_meetings, is_eligible_board,
    outcome_from_motion, votes_for_motion,
)

# Real motion for Resolution No. 2026-107 (Chipotle), meeting 11344.
CHIPOTLE_APPROVE_MOTION = {
    "motionType": {"name": "To Approve"},
    "votingResult": True,
    "wording": "Councilmember Cohen moved to approve Resolution No. 2026-107...",
    "voteIso": "2026-09-09T01:37:14.776Z",
    "votes": [
        {"vote": "Yea", "member": {"name": "Heidi Henkel"}},
        {"vote": "Nay", "member": {"name": "Austin Ward"}},
    ],
}

# Real motions for the EV Charging ordinance (meeting 11344) -- the live
# case that proves array order isn't chronological order: "To Approve" is
# motions[0] but its voteIso is LATER than "To Amend" at motions[1].
EV_CHARGING_APPROVE_MOTION = {
    "motionType": {"name": "To Approve"},
    "votingResult": True,
    "wording": "Councilmember Anderson moved to approve Ordinance No. 2301...",
    "voteIso": "2026-09-09T02:03:55.319Z",
}
EV_CHARGING_AMEND_MOTION = {
    "motionType": {"name": "To Amend"},
    "votingResult": False,
    "wording": "Councilmember Ward moved to amend Ordinance No. 2301...",
    "voteIso": "2026-09-09T02:03:20.955Z",
}


def test_to_approve_true_is_approved():
    assert outcome_from_motion(CHIPOTLE_APPROVE_MOTION) == "approved"


def test_to_approve_false_is_denied():
    m = {**CHIPOTLE_APPROVE_MOTION, "votingResult": False}
    assert outcome_from_motion(m) == "denied"


def test_unrecognized_motion_type_is_other_not_guessed():
    # Nothing in the live sample confirms how "To Deny"/"To Continue"/
    # "To Table" should map -- verify-don't-invent, so these fall to
    # 'other' rather than a guessed mapping.
    for name in ["To Deny", "To Continue", "To Table", "To Postpone"]:
        m = {"motionType": {"name": name}, "votingResult": True}
        assert outcome_from_motion(m) == "other"


def test_to_amend_is_never_dispositive_on_its_own():
    assert outcome_from_motion(EV_CHARGING_AMEND_MOTION) == "other"


def test_pending_when_voting_result_is_none():
    m = {**CHIPOTLE_APPROVE_MOTION, "votingResult": None}
    assert outcome_from_motion(m) == "pending"


def test_final_motion_uses_voteIso_not_array_position():
    # Real bug this guards against: array order lists "To Approve" BEFORE
    # "To Amend", but voteIso shows the amendment vote happened ~35
    # seconds EARLIER. Picking motions[-1] would wrongly select the
    # amendment as "final."
    motions = [EV_CHARGING_APPROVE_MOTION, EV_CHARGING_AMEND_MOTION]
    assert final_motion(motions) is EV_CHARGING_APPROVE_MOTION


def test_final_motion_ignores_non_dispositive_motions_entirely():
    assert final_motion([EV_CHARGING_AMEND_MOTION]) is None


def test_final_motion_none_when_no_motions():
    assert final_motion([]) is None


def test_final_motion_picks_latest_dispositive_motion_by_time():
    earlier = {"motionType": {"name": "To Approve"}, "votingResult": False, "voteIso": "2026-09-09T01:00:00Z"}
    later = {"motionType": {"name": "To Approve"}, "votingResult": True, "voteIso": "2026-09-09T02:00:00Z"}
    assert final_motion([later, earlier]) is later


def test_is_eligible_board_excludes_boards_that_never_reach_minutes():
    assert is_eligible_board("City Council Study Session") is False
    assert is_eligible_board("City Council Workshop") is False
    assert is_eligible_board("City Council Executive Session") is False


def test_is_eligible_board_includes_regular_and_special_meetings():
    assert is_eligible_board("City Council Regular Meeting") is True
    assert is_eligible_board("City Council Special Meeting") is True
    assert is_eligible_board("City Council Transition Meeting") is True


def test_votes_for_motion_maps_member_name_and_vote_value():
    votes = votes_for_motion(CHIPOTLE_APPROVE_MOTION)
    assert votes == [
        {"person": "Heidi Henkel", "value": "Yea"},
        {"person": "Austin Ward", "value": "Nay"},
    ]


def test_votes_for_motion_none_when_empty():
    assert votes_for_motion(EV_CHARGING_APPROVE_MOTION) is None


def _fake_conn(rows):
    """Mock connection/cursor (no real DB), same convention as
    tests/test_db_upsert_dedup.py."""
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


def test_find_candidate_meetings_query_excludes_meetings_that_already_have_decisions():
    # QA finding #1 (2026-10), owner-approved fix: this must be a NOT EXISTS
    # in the query itself, not a Python-side filter after the fact -- the
    # whole point is to never spend an API call on a meeting that's already
    # done, not just skip using its result.
    conn, cur = _fake_conn(rows=[])
    find_candidate_meetings(conn, "broomfield_co")
    sql = cur.execute.call_args[0][0]
    assert "NOT EXISTS" in sql
    assert "meeting_decisions" in sql


def test_find_candidate_meetings_uses_a_90_day_window_not_a_60_day_minimum_gate():
    # The real bug: the old version required a meeting to be >= 60 days old
    # before even TRYING it, which skipped the Sep 23 Broomfield meeting
    # even though its minutes were already publishStatus=='minutes' at 22
    # days old. Now: a real [now - 90 days, now] window, checked every run.
    conn, cur = _fake_conn(rows=[])
    find_candidate_meetings(conn, "broomfield_co")
    sql, params = cur.execute.call_args[0]
    assert params == ("broomfield_co", FETCH_WINDOW_DAYS)
    assert FETCH_WINDOW_DAYS == 90
    assert "meeting_date <= now()" in sql
    assert "meeting_date >= now() - (%s * interval '1 day')" in sql


def test_find_candidate_meetings_does_not_reintroduce_the_quoted_placeholder_bug():
    # Live-verified against the real DB (2026-10-15): `interval '%s days'`
    # puts the placeholder INSIDE the quoted literal, which psycopg still
    # textually substitutes (as `$1`) but Postgres then parses as the
    # literal STRING "$1 days" -- its interval parser silently accepts
    # that as exactly 1 day, no matter what value is actually bound. A
    # future edit reintroducing this form would silently break the window
    # again (same way it broke the original 60-day gate) without any test
    # failure from a mocked cursor, so this guards the SQL text itself.
    conn, cur = _fake_conn(rows=[])
    find_candidate_meetings(conn, "broomfield_co")
    sql = cur.execute.call_args[0][0]
    assert "interval '%s" not in sql


def test_find_candidate_meetings_still_filters_ineligible_boards_after_the_query():
    conn, cur = _fake_conn(rows=[
        (1, "City Council Study Session", "url1", "native1"),
        (2, "City Council Regular Meeting", "url2", "native2"),
    ])
    result = find_candidate_meetings(conn, "broomfield_co")
    assert [m["id"] for m in result] == [2]
