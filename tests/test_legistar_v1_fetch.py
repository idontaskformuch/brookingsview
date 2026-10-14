"""Document-fetch visibility for legistar_v1.py's eventitems sub-fetch --
same bug/fix as escribe_v1.py's agenda/minutes/action-summary (see
tests/test_escribe_v1.py's own doc-fetch section and db.finish_run()'s
docstring): a failed eventitems request used to only reach a print(),
never scrape_runs.
"""
from scrapers.base_parser import FetchResult
from scrapers.parsers.legistar_v1 import LegistarParser


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
