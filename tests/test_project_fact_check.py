"""Regression test for ai_pipeline/project_fact_check.py's source-text
extraction -- same "fake the storage, run the real logic" approach as
tests/test_new_in_town_digest.py's _FakeBizConn.

Real bug this guards against: AgendaLink agenda items (scrapers/parsers/
agendalink_v1.py) store their body text under "details", not
"description" -- _source_text_case_numbers() used to read only
"description", so every Broomfield meeting's real agenda memo text was
silently invisible to the fact-check guardrail (source text = title only).
"""
from ai_pipeline.project_fact_check import _source_text_case_numbers


class _FakeMeetingsCursor:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, params=()):
        pass

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeMeetingsConn:
    def __init__(self, rows):
        self.rows = rows

    def cursor(self):
        return _FakeMeetingsCursor(self.rows)


AGENDALINK_ITEM = {
    "title": "Public Hearing - Palisade Park Chipotle Mexican Grill (Resolution No. 2026-107)",
    "details": "The applicant, Chipotle Mexican Grill, Inc., proposes a freestanding "
                "restaurant on a 1.03-acre property at 700 W 168th Place.",
}


def test_agendalink_details_text_is_included_as_source_text():
    conn = _FakeMeetingsConn([({"agenda_items": [AGENDALINK_ITEM]},)])
    text = _source_text_case_numbers(conn, "broomfield_co", ["2026-107"])
    assert "700 W 168th Place" in text
    assert "Chipotle Mexican Grill, Inc." in text


def test_no_match_when_case_number_absent():
    conn = _FakeMeetingsConn([({"agenda_items": [AGENDALINK_ITEM]},)])
    text = _source_text_case_numbers(conn, "broomfield_co", ["2026-999"])
    assert text == ""
