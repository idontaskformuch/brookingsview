"""Phase 7 ('Decisions') outcome/consent-vote logic -- see
ai_pipeline/meeting_decisions_legistar.py's own module docstring for the
real, live-verified cityofbrookings cases these encode."""
from pathlib import Path

from ai_pipeline.meeting_decisions_legistar import (
    consent_votes, dedupe_shadow_items, outcome_from_item, upsert_decision,
)


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


def test_dedupe_drops_signal_less_duplicate_sharing_matter_and_agenda_number():
    """Real, verified cityofbrookings case: event 3368, MatterId 8903,
    agenda number '6b.' ('Rezone Lot 1 of Clark 2nd Addition') posts TWO
    EventItems for the one real vote -- 94873 (the real Pass/9-0 action)
    and 95301 (same MatterId, SAME agenda number, but ActionName/
    PassedFlagName/votes all null). Ingesting both would show the same
    decision twice: correctly under Decided, falsely again under On the
    agenda. The signal-less one must be dropped."""
    real = {"EventItemId": 94873, "EventItemAgendaNumber": "6b.", "EventItemMatterId": 8903,
            "EventItemActionName": "approved", "EventItemPassedFlagName": "Pass"}
    shadow = {"EventItemId": 95301, "EventItemAgendaNumber": "6b.", "EventItemMatterId": 8903,
              "EventItemActionName": None, "EventItemPassedFlagName": None, "votes": None}
    other_item = {"EventItemId": 1, "EventItemAgendaNumber": "3a.", "EventItemMatterId": 1,
                  "EventItemActionName": "approved", "EventItemPassedFlagName": "Pass"}
    result = dedupe_shadow_items([real, shadow, other_item])
    assert {item["EventItemId"] for item in result} == {94873, 1}


def test_dedupe_keeps_every_item_when_all_siblings_have_real_signal():
    """Real, verified cityofbrookings case: event 3365, MatterId 9111
    ('Amendments to Sec. 51-61... Subdivision Regulations') has THREE
    EventItems, each with its own real ActionName/PassedFlagName -- a
    genuine sequence of separate real votes within one meeting (a motion
    failing, then a reconsidered/amended version passing), not a
    duplicate. None may be dropped."""
    v1 = {"EventItemId": 97283, "EventItemAgendaNumber": "7d.", "EventItemMatterId": 9111,
          "EventItemActionName": "denied", "EventItemPassedFlagName": "Fail"}
    v2 = {"EventItemId": 97609, "EventItemAgendaNumber": "7d.", "EventItemMatterId": 9111,
          "EventItemActionName": "denied", "EventItemPassedFlagName": "Fail"}
    v3 = {"EventItemId": 97610, "EventItemAgendaNumber": "7d.", "EventItemMatterId": 9111,
          "EventItemActionName": "amended", "EventItemPassedFlagName": "Pass"}
    assert dedupe_shadow_items([v1, v2, v3]) == [v1, v2, v3]


def test_dedupe_keeps_ambiguous_group_when_every_sibling_lacks_signal():
    """Two signal-less items sharing a matter+agenda number is ambiguous
    (not the live-verified shape, which always has exactly one real
    sibling) -- never guessed away, both kept."""
    a = {"EventItemId": 1, "EventItemAgendaNumber": "6b.", "EventItemMatterId": 8903,
         "EventItemActionName": None, "EventItemPassedFlagName": None}
    b = {"EventItemId": 2, "EventItemAgendaNumber": "6b.", "EventItemMatterId": 8903,
         "EventItemActionName": None, "EventItemPassedFlagName": None}
    assert dedupe_shadow_items([a, b]) == [a, b]


def test_dedupe_passes_through_items_with_no_matter_id():
    item = {"EventItemId": 1, "EventItemAgendaNumber": None, "EventItemMatterId": None}
    assert dedupe_shadow_items([item]) == [item]


def test_non_consent_item_never_gets_a_block_id():
    item = {
        "EventItemId": 100759, "EventItemConsent": 0,
        "votes": [{"person": "Holly Tilton Byrne", "value": "Yes", "vote_event_item_id": 100759}],
    }
    is_consent, block_id, votes = consent_votes(item)
    assert is_consent is False
    assert block_id is None


# --- upsert_decision: source_system/source_item_id always set -------------
# See db/migrations/055_meeting_decisions_source_system.sql's own comment:
# Migration B's later CHECK (source_system/source_item_id always set) would
# reject every row this writer produces if it didn't set them -- silently
# stopping Brookings' scheduled decision updates. "fake the storage, run
# the real logic" -- same approach as tests/test_new_in_town_digest.py's
# _FakeBizConn.

class _FakeDecisionsCursor:
    def __init__(self, store: dict):
        self.store = store
        self._inserted = None

    def execute(self, sql, params):
        norm = " ".join(sql.split())
        assert norm.startswith("INSERT INTO meeting_decisions"), f"unexpected SQL: {norm!r}"
        key = params["event_item_id"]
        self._inserted = key not in self.store
        self.store[key] = dict(params)

    def fetchone(self):
        return (self._inserted,)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeDecisionsConn:
    def __init__(self):
        self.store: dict = {}

    def cursor(self):
        return _FakeDecisionsCursor(self.store)


def test_upsert_decision_sets_source_system_and_item_id_on_insert():
    conn = _FakeDecisionsConn()
    item = {"EventItemId": 100759, "EventItemTitle": "Second Reading",
            "EventItemActionName": "approved", "EventItemPassedFlagName": "Pass"}
    inserted = upsert_decision(conn, meeting_id=1, source_url=None, item=item)
    assert inserted is True
    row = conn.store[100759]
    assert row["source_system"] == "legistar"
    assert row["source_item_id"] == "100759"


def test_upsert_decision_sets_source_system_and_item_id_on_reinsert_too():
    # Same item ingested twice (a later scheduled run re-processing the same
    # meeting) -- the fields must still be correct the second time, not
    # just on first insert.
    conn = _FakeDecisionsConn()
    item = {"EventItemId": 7, "EventItemTitle": "First Reading"}
    upsert_decision(conn, meeting_id=1, source_url=None, item=item)
    second = dict(item, EventItemActionName="approved", EventItemPassedFlagName="Pass")
    inserted_again = upsert_decision(conn, meeting_id=1, source_url=None, item=second)
    assert inserted_again is False
    row = conn.store[7]
    assert row["source_system"] == "legistar"
    assert row["source_item_id"] == "7"


def test_on_conflict_clause_also_updates_source_fields():
    # The fake cursor above can't exercise real Postgres ON CONFLICT
    # semantics -- a source-text guard on the real SQL instead, so a future
    # edit that adds a column to the INSERT list but forgets the matching
    # SET clause (an easy copy-paste miss, same class of bug this whole
    # migration split exists to avoid) gets caught.
    source = Path(__file__).resolve().parent.parent / "ai_pipeline" / "meeting_decisions_legistar.py"
    text = source.read_text(encoding="utf-8")
    on_conflict = text[text.index("ON CONFLICT (event_item_id) DO UPDATE SET"):text.index("RETURNING")]
    assert "source_system = EXCLUDED.source_system" in on_conflict
    assert "source_item_id = EXCLUDED.source_item_id" in on_conflict
