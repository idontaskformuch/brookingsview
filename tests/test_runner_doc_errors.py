"""Regression test for the document-fetch-visibility bug: a parser whose
main fetch() succeeds but whose per-document sub-fetches (escribe_v1's
agenda/minutes/action-summary, legistar_v1's eventitems) all fail used to
log status='ok' in scrape_runs, because those failures only reached a
print() -- see FetchResult.docs_attempted/docs_failed (scrapers/
base_parser.py) and db.finish_run()'s own docstring. This exercises
scrapers.runner.run_source()'s own downgrade logic against a fake parser +
fake db, not a real network/DB.
"""
from scrapers import runner
from scrapers.base_parser import BaseParser, FetchResult


class _RecordingDb:
    """Stand-in for db.db -- records exactly what run_source() would have
    written to scrape_runs, without a real connection."""

    def __init__(self):
        self.finish_calls = []
        self._next_run_id = 1

    def start_run(self, conn, town_id, source_key):
        run_id = self._next_run_id
        self._next_run_id += 1
        return run_id

    def finish_run(self, conn, run_id, status, http_code=None, items_found=0,
                   items_new=0, error=None, docs_attempted=0, docs_failed=0,
                   docs_last_error=None):
        self.finish_calls.append(dict(
            run_id=run_id, status=status, http_code=http_code,
            items_found=items_found, items_new=items_new, error=error,
            docs_attempted=docs_attempted, docs_failed=docs_failed,
            docs_last_error=docs_last_error,
        ))

    def save_snapshot(self, conn, town_id, source_key, url, raw, content_type):
        return 1

    def upsert_records(self, conn, table, town_id, records, snapshot_id,
                        conflict_columns=None, update_columns=None,
                        dedup_check_columns=None):
        return len(records)

    def last_run_at(self, conn, town_id, source_key):
        return None

    def consecutive_failures(self, conn, town_id, source_key):
        return 0


class _AllDocsFailParser(BaseParser):
    table = "meetings"
    platform = "fake"

    def fetch(self) -> FetchResult:
        return FetchResult(raw=b"{}", content_type="application/json",
                            docs_attempted=3, docs_failed=3,
                            docs_last_error="action summary: 403 (möte 1)")

    def parse(self, fetched: FetchResult) -> list[dict]:
        return [{"content_hash": "x"}]


class _SomeDocsFailParser(BaseParser):
    table = "meetings"
    platform = "fake"

    def fetch(self) -> FetchResult:
        return FetchResult(raw=b"{}", content_type="application/json",
                            docs_attempted=3, docs_failed=1,
                            docs_last_error="minutes: timeout (möte 2)")

    def parse(self, fetched: FetchResult) -> list[dict]:
        return [{"content_hash": "x"}]


class _NoDocsParser(BaseParser):
    table = "meetings"
    platform = "fake"

    def fetch(self) -> FetchResult:
        return FetchResult(raw=b"{}", content_type="application/json")

    def parse(self, fetched: FetchResult) -> list[dict]:
        return [{"content_hash": "x"}]


def _run(monkeypatch, parser_cls):
    fake_db = _RecordingDb()
    monkeypatch.setattr(runner, "db", fake_db)
    monkeypatch.setattr(
        runner, "_load_parser",
        lambda dotted, cfg, source_cfg: parser_cls(cfg, source_cfg),
    )
    monkeypatch.setitem(runner.REGISTRY, "fake", "tests.test_runner_doc_errors:_unused")
    runner.run_source(conn=None, cfg={"town_id": "moreno_valley_ca"},
                       source_key="fake", source_cfg={"type": "fake", "enabled": True})
    assert len(fake_db.finish_calls) == 1
    return fake_db.finish_calls[0]


def test_all_documents_failing_downgrades_status_to_degraded(monkeypatch):
    call = _run(monkeypatch, _AllDocsFailParser)
    assert call["status"] == "degraded"
    assert call["docs_attempted"] == 3
    assert call["docs_failed"] == 3
    assert call["docs_last_error"] == "action summary: 403 (möte 1)"


def test_some_documents_failing_still_counts_as_ok(monkeypatch):
    # 1 of 3 failed -- a real, not-total failure. Visible via docs_failed,
    # but not the "0 lyckade dokument av N" case that must not look like 'ok'.
    call = _run(monkeypatch, _SomeDocsFailParser)
    assert call["status"] == "ok"
    assert call["docs_failed"] == 1


def test_no_documents_attempted_is_unaffected(monkeypatch):
    # A source with no sub-documents at all (most parsers) must not be
    # touched by this logic.
    call = _run(monkeypatch, _NoDocsParser)
    assert call["status"] == "ok"
    assert call["docs_attempted"] == 0
    assert call["docs_failed"] == 0
