"""Tests for escribe_v1._parse_action_summary -- see NEEDS-HUMAN-REVIEW.md,
"Week 3 -- City Hall Project Pages". The Action Summary PDF is a
per-agenda-item outcome record eSCRIBE posts alongside PostMinutes for City
Council Regular Meetings (verified live: Planning Commission meetings never
carry either document). One block per item, delimited by a repeated
"Action Summary" header line -- parsed with a fixed regex per field, never
inferred: a missing RESULT line means result=None, not a guessed outcome.
"""
from scrapers.parsers.escribe_v1 import _parse_action_summary


def block(counter: str, title: str, result: str | None = None, vote: str | None = None) -> str:
    lines = [
        "Action Summary",
        "City Council Regular Meeting",
        f"Agenda Number: {counter}",
        f"Title: {title}",
        "Date: June 16, 2026",
        "Moved by: Councilmember Delgado District 2",
        "Seconded by: Mayor Pro Tem Gonzalez District 3",
        "Approve the item",
    ]
    if vote:
        lines.append(vote)
    if result:
        lines.append(f"RESULT: {result}")
    return "\n".join(lines)


def test_parses_counter_title_and_result():
    text = block("K.1.", "MUNICIPAL CODE AMENDMENT (PEN26-0059)", result="Approved",
                 vote="YES: 5 NO: 0 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0")
    items = _parse_action_summary(text)
    assert len(items) == 1
    assert items[0]["counter"] == "K.1."
    assert items[0]["title"] == "MUNICIPAL CODE AMENDMENT (PEN26-0059)"
    assert items[0]["result"] == "Approved"
    assert items[0]["vote"] == {"yes": 5, "no": 0, "abstain": 0, "conflict": 0, "absent": 0}


def test_captures_a_non_unanimous_vote():
    text = block("L.1.", "DISCUSSION ON FUNDING", result="Approved",
                 vote="YES: 4 NO: 1 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0")
    items = _parse_action_summary(text)
    assert items[0]["vote"]["yes"] == 4
    assert items[0]["vote"]["no"] == 1


def test_item_with_no_result_line_stays_none_not_guessed():
    text = block("K.3.", "ANNUAL STAFFING VACANCIES REPORT")  # no RESULT, no vote -- informational only
    items = _parse_action_summary(text)
    assert items[0]["result"] is None
    assert "vote" not in items[0]


def test_multiline_title_is_joined_and_whitespace_collapsed():
    text = (
        "Action Summary\n"
        "City Council Regular Meeting\n"
        "Agenda Number: K.2.\n"
        "Title: AMENDMENT TO THE VILLAGE SPECIFIC PLAN 204 (SP 204) (PEN26-\n"
        "0019) (REPORT OF: COMMUNITY DEVELOPMENT) (DISTRICT: 1)\n"
        "Date: June 16, 2026\n"
        "RESULT: Approved\n"
    )
    items = _parse_action_summary(text)
    assert items[0]["title"] == "AMENDMENT TO THE VILLAGE SPECIFIC PLAN 204 (SP 204) (PEN26- 0019) (REPORT OF: COMMUNITY DEVELOPMENT) (DISTRICT: 1)"


def test_parses_multiple_blocks_in_sequence():
    text = "\n".join([
        block("H.", "APPROVAL OF ORDER OF AGENDA", result="Approved", vote="YES: 5 NO: 0 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0"),
        block("J.", "JOINT CONSENT CALENDARS", result="Approved", vote="YES: 5 NO: 0 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0"),
        block("K.1.", "MUNICIPAL CODE AMENDMENT (PEN26-0059)", result="Approved", vote="YES: 5 NO: 0 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0"),
    ])
    items = _parse_action_summary(text)
    assert [i["counter"] for i in items] == ["H.", "J.", "K.1."]


def test_denied_and_continued_results_pass_through_verbatim():
    text = block("I.3.", "EDGEMONT COMMERCE CENTER", result="Denied",
                 vote="YES: 1 NO: 4 ABSTAIN: 0 CONFLICT: 0 ABSENT: 0")
    items = _parse_action_summary(text)
    assert items[0]["result"] == "Denied"
    text2 = block("I.4.", "SOME OTHER ITEM", result="Continued")
    items2 = _parse_action_summary(text2)
    assert items2[0]["result"] == "Continued"


def test_empty_text_returns_no_items():
    assert _parse_action_summary("") == []


def test_malformed_block_missing_agenda_number_is_skipped():
    text = "Action Summary\nCity Council Regular Meeting\nTitle: NO AGENDA NUMBER HERE\nRESULT: Approved\n"
    assert _parse_action_summary(text) == []
