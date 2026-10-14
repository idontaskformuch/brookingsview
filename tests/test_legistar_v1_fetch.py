"""Document-fetch visibility for legistar_v1.py's eventitems sub-fetch --
same bug/fix as escribe_v1.py's agenda/minutes/action-summary (see
tests/test_escribe_v1.py's own doc-fetch section and db.finish_run()'s
docstring): a failed eventitems request used to only reach a print(),
never scrape_runs.
"""
from scrapers.base_parser import FetchResult
from scrapers.parsers.legistar_v1 import LegistarParser, _clean_item


class _FakeResponse:
    def __init__(self, status_code: int, json_body=None):
        self.status_code = status_code
        self._json_body = json_body
        self.url = "https://webapi.legistar.com/v1/fake/events"

    def json(self):
        return self._json_body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _parser():
    return LegistarParser({"town_id": "brookings_sd"}, {"client_id": "fake"})


def test_fetch_counts_eventitems_failures(monkeypatch):
    events = [{"EventId": 1, "EventBodyName": "City Council", "EventDate": "2026-09-24T18:00:00"},
              {"EventId": 2, "EventBodyName": "Planning Commission", "EventDate": "2026-09-25T18:00:00"}]

    monkeypatch.setattr(
        "scrapers.parsers.legistar_v1.requests.get",
        lambda url, params=None, timeout=None, headers=None: (
            _FakeResponse(200, json_body=events) if url.endswith("/events")
            else _FakeResponse(403)
        ),
    )

    result = _parser().fetch()

    assert isinstance(result, FetchResult)
    assert result.docs_attempted == 2
    assert result.docs_failed == 2
    assert result.docs_last_error is not None


def test_fetch_counts_zero_when_no_events(monkeypatch):
    monkeypatch.setattr(
        "scrapers.parsers.legistar_v1.requests.get",
        lambda url, params=None, timeout=None, headers=None: _FakeResponse(200, json_body=[]),
    )

    result = _parser().fetch()

    assert result.docs_attempted == 0
    assert result.docs_failed == 0
    assert result.docs_last_error is None


def test_fetch_gets_votes_only_for_items_with_matter_and_flag(monkeypatch):
    """Phase 7 ('Decisions'): a vote fetch only fires for an item that has
    BOTH a real Matter attached and a set Pass/Fail flag -- procedural rows
    (no matter, no flag) never trigger one. Verified live against
    cityofbrookings 2026-10-14 that this is exactly the subset Legistar
    actually records a roll call for."""
    events = [{"EventId": 1, "EventBodyName": "City Council", "EventDate": "2026-09-24T18:00:00"}]
    items = [
        {"EventItemId": 10, "EventItemTitle": "Call to Order"},  # no matter, no flag
        {"EventItemId": 11, "EventItemTitle": "Presented", "EventItemMatterId": 500,
         "EventItemActionName": "presented"},  # matter, but no flag
        {"EventItemId": 12, "EventItemTitle": "Approved thing", "EventItemMatterId": 501,
         "EventItemPassedFlagName": "Pass"},  # matter + flag -> fetch votes
    ]
    vote_calls = []

    def fake_get(url, params=None, timeout=None, headers=None):
        if url.endswith("/events"):
            return _FakeResponse(200, json_body=events)
        if url.endswith("/eventitems"):
            return _FakeResponse(200, json_body=items)
        if "/votes" in url:
            vote_calls.append(url)
            return _FakeResponse(200, json_body=[
                {"VotePersonName": "A Person", "VoteValueName": "Yes", "VoteEventItemId": 12},
            ])
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr("scrapers.parsers.legistar_v1.requests.get", fake_get)
    monkeypatch.setattr("scrapers.parsers.legistar_v1.time.sleep", lambda *_: None)

    result = _parser().fetch()

    assert vote_calls == ["https://webapi.legistar.com/v1/fake/eventitems/12/votes"]
    assert result.docs_attempted == 2  # 1 eventitems + 1 votes
    assert result.docs_failed == 0


def test_clean_item_keeps_falsy_consent_flag():
    """EventItemConsent=0 is a real, meaningful value ('not a consent item'),
    not a missing field -- must survive, unlike the `keep` tuple's fields
    (which intentionally drop falsy/empty values)."""
    item = {"EventItemId": 42, "EventItemTitle": "A thing", "EventItemConsent": 0,
            "EventItemPassedFlagName": None, "EventItemMatterId": None}
    cleaned = _clean_item(item)
    assert cleaned["EventItemId"] == 42
    assert cleaned["EventItemConsent"] is False
    assert cleaned["EventItemPassedFlagName"] is None


def test_clean_item_includes_votes_when_present():
    item = {
        "EventItemId": 100738, "EventItemTitle": "Consent sub-item",
        "EventItemConsent": 1, "EventItemPassedFlagName": "Pass", "EventItemMatterId": 8951,
        "_votes": [{"VotePersonName": "Holly Tilton Byrne", "VoteValueName": "Yes", "VoteEventItemId": 101100}],
    }
    cleaned = _clean_item(item)
    assert cleaned["EventItemConsent"] is True
    assert cleaned["votes"] == [
        {"person": "Holly Tilton Byrne", "value": "Yes", "vote_event_item_id": 101100},
    ]
