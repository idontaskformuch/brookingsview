"""Phase 7 ('Decisions') outcome/consent-vote logic -- see
ai_pipeline/meeting_decisions_legistar.py's own module docstring for the
real, live-verified cityofbrookings cases these encode."""
from ai_pipeline.meeting_decisions_legistar import consent_votes, outcome_from_item


def test_fail_flag_wins_even_when_action_name_says_approved():
    """The real, verified cityofbrookings case: event 3540/item 100490 --
    ActionName='approved' but PassedFlagName='Fail', MatterStatus='Failed',
    and all 7 roll-call votes were 'No'. The Pass/Fail flag must win."""
    item = {"EventItemActionName": "approved", "EventItemPassedFlagName": "Fail",
            "EventItemMatterStatus": "Failed"}
    assert outcome_from_item(item) == "denied"


def test_pass_flag_with_plain_approved_action():
    item = {"EventItemActionName": "approved", "EventItemPassedFlagName": "Pass"}
    assert outcome_from_item(item) == "approved"


def test_pass_flag_with_adopt_action():
    item = {"EventItemActionName": "adopted", "EventItemPassedFlagName": "Pass"}
    assert outcome_from_item(item) == "adopted"


def test_no_flag_but_filed_status_is_received_and_filed():
    """A Proclamation/Informational Report has no vote at all --
    EventItemMatterStatus='Filed' is still a real, structured Legistar
    fact, not a guess."""
    item = {"EventItemActionName": "presented", "EventItemPassedFlagName": None,
            "EventItemMatterStatus": "Filed"}
    assert outcome_from_item(item) == "received_and_filed"


def test_no_flag_no_status_but_real_action_name_is_other():
    item = {"EventItemActionName": "read into the record", "EventItemPassedFlagName": None,
            "EventItemMatterStatus": None}
    assert outcome_from_item(item) == "other"


def test_nothing_at_all_is_pending():
    """No official result posted yet -- this is the 'On the agenda' state,
    not a guess at an outcome."""
    item = {"EventItemActionName": None, "EventItemPassedFlagName": None,
            "EventItemMatterStatus": None}
    assert outcome_from_item(item) == "pending"


def test_consent_sub_item_detects_shared_block_vote():
    """Verified live: a consent sub-item's own /votes response returns
    vote rows whose VoteEventItemId points at the block item (101100), not
    the sub-item's own id (100738)."""
    item = {
        "EventItemId": 100738, "EventItemConsent": 1,
        "votes": [
            {"person": "Holly Tilton Byrne", "value": "Yes", "vote_event_item_id": 101100},
            {"person": "Bonny Specker", "value": "Yes", "vote_event_item_id": 101100},
        ],
    }
    is_consent, block_id, votes = consent_votes(item)
    assert is_consent is True
    assert block_id == 101100
    assert votes == item["votes"]


def test_consent_block_item_itself_has_no_block_id():
    """The block item's own votes point at itself -- not flagged as
    'belonging to another item'."""
    item = {
        "EventItemId": 101100, "EventItemConsent": 1,
        "votes": [{"person": "Holly Tilton Byrne", "value": "Yes", "vote_event_item_id": 101100}],
    }
    is_consent, block_id, votes = consent_votes(item)
    assert is_consent is True
    assert block_id is None


def test_non_consent_item_never_gets_a_block_id():
    item = {
        "EventItemId": 100759, "EventItemConsent": 0,
        "votes": [{"person": "Holly Tilton Byrne", "value": "Yes", "vote_event_item_id": 100759}],
    }
    is_consent, block_id, votes = consent_votes(item)
    assert is_consent is False
    assert block_id is None
