"""Phase 7 ('Decisions'), AgendaLink/Broomfield -- see
ai_pipeline/meeting_decisions_agendalink.py's own module docstring for the
real, live-verified Broomfield cases these encode (meeting 11344, 2026-09-08
Regular Meeting: Palisade Park Chipotle Mexican Grill resolutions and the
EV Charging ordinance)."""
from ai_pipeline.meeting_decisions_agendalink import (
    final_motion, is_eligible_board, outcome_from_motion, votes_for_motion,
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
