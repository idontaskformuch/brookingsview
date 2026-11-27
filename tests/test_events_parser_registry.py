"""Coverage for scrapers/parsers/events.py's own dispatch logic after the
Fas 3 del 1 source-registry refactor: EventsParser itself now only decides
(a) is this kind an inert marker ("blocked"/"unconfirmed"), (b) is this kind
registered in scrapers/event_sources.py, (c) otherwise skip as unknown --
the actual fetch/parse work is scrapers/event_sources.py's job (see
test_event_sources.py). These tests use a stub kind so they don't depend on
network or real config, complementing (not duplicating) the real-feed
baseline diff done during the refactor itself.
"""
from scrapers.base_parser import FetchResult
from scrapers.event_sources import EVENT_SOURCE_KINDS, EventSourceKind
from scrapers.parsers.events import EventsParser


def _stub_kind():
    def fetch(source_cfg, headers):
        return f"blob-for-{source_cfg['name']}".encode()

    def parse(name, blob, tzname):
        return [{"title": name, "content_hash": name, "raw": blob.decode()}]

    return EventSourceKind(fetch=fetch, parse=parse)


def _install_stub_kind():
    EVENT_SOURCE_KINDS["stub"] = _stub_kind()


def _remove_stub_kind():
    EVENT_SOURCE_KINDS.pop("stub", None)


def _parser(sources):
    # a real town: user_agent() has no fallback town since audit Fas 2
    cfg = {"town_id": "brookings_sd", "timezone": "America/Chicago"}
    source_cfg = {"sources": sources}
    return EventsParser(cfg, source_cfg)


# 2026-10-02, item D3: without these, db.upsert_records() falls back to
# ON CONFLICT (town_id, content_hash) DO NOTHING -- a corrected re-scrape
# (same source uid, different starts_at/title) would hash-match the old row
# and then write nothing, leaving the stale fields in place forever. See
# event_sources.py's own content_hash comment for the real incident this
# fixes (a Brookings chamber meetup rescheduled on the source site).
def test_update_columns_cover_every_field_a_source_correction_could_touch():
    assert EventsParser.conflict_columns == ("town_id", "content_hash")
    assert set(EventsParser.update_columns) == {
        "title", "starts_at", "ends_at", "venue", "url", "raw_data",
    }


def test_blocked_and_unconfirmed_sources_never_hit_registry(capsys):
    parser = _parser([
        {"name": "parks", "kind": "blocked", "url": "https://example.com/blocked"},
        {"name": "amphitheater", "kind": "unconfirmed", "url": "https://example.com/unconfirmed"},
    ])
    fetched = parser.fetch()
    out = capsys.readouterr().out
    assert "policyblockerad" in out
    assert "overifierad" in out
    assert fetched.raw == b""
    assert parser.parse(fetched) == []


def test_unknown_kind_skipped():
    parser = _parser([{"name": "mystery", "kind": "carrier-pigeon", "url": "https://example.com"}])
    fetched = parser.fetch()
    assert fetched.raw == b""
    assert parser.parse(fetched) == []


def test_registered_kind_routes_through_registry_fetch_and_parse():
    _install_stub_kind()
    try:
        parser = _parser([{"name": "widget_events", "kind": "stub", "url": "https://example.com"}])
        fetched = parser.fetch()
        records = parser.parse(fetched)
        assert records == [{
            "title": "widget_events", "content_hash": "widget_events",
            "raw": "blob-for-widget_events",
        }]
    finally:
        _remove_stub_kind()


def test_mixed_sources_one_broken_never_blocks_the_others(capsys):
    _install_stub_kind()

    def failing_fetch(source_cfg, headers):
        raise RuntimeError("network exploded")

    EVENT_SOURCE_KINDS["flaky"] = EventSourceKind(fetch=failing_fetch, parse=lambda n, b: [])
    try:
        parser = _parser([
            {"name": "good_source", "kind": "stub", "url": "https://example.com/good"},
            {"name": "flaky_source", "kind": "flaky", "url": "https://example.com/flaky"},
        ])
        fetched = parser.fetch()
        records = parser.parse(fetched)
        assert "fel vid hämtning" in capsys.readouterr().out
        assert [r["title"] for r in records] == ["good_source"]
    finally:
        _remove_stub_kind()
        EVENT_SOURCE_KINDS.pop("flaky", None)


def test_an_empty_body_is_recorded_on_the_run_so_ops_ical_empty_can_see_it_last(capsys):
    # 2026-11-26 Brookings' "chamber" feed (configs/brookings_sd.json) answered 200 with an empty body. The other sources are still read,
    # the run stays 'ok' (docs_attempted 0), and the source name lands in docs_last_error (scrape_runs) for scripts/check_freshness.py.
    from scrapers.event_sources import EmptyBody
    _install_stub_kind()

    def empty_fetch(source_cfg, headers):
        raise EmptyBody(source_cfg["name"])

    EVENT_SOURCE_KINDS["empty"] = EventSourceKind(fetch=empty_fetch, parse=lambda n, b, tz: [])
    try:
        parser = _parser([
            {"name": "library", "kind": "stub", "url": "https://example.com/good"},
            {"name": "chamber", "kind": "empty", "url": "https://example.com/empty"},
        ])
        fetched = parser.fetch()
        assert [r["title"] for r in parser.parse(fetched)] == ["library"]
        assert fetched.docs_last_error == "warning: empty response body: chamber"
        assert fetched.docs_attempted == 0 and fetched.docs_failed == 0
        assert "fel vid hämtning" not in capsys.readouterr().out
        # a run with no empty body writes nothing there
        assert _parser([{"name": "library", "kind": "stub", "url": "https://example.com/good"}]).fetch().docs_last_error is None
    finally:
        _remove_stub_kind()
        EVENT_SOURCE_KINDS.pop("empty", None)


def test_parse_reconstructs_from_raw_snapshot_when_blobs_not_cached():
    # simulates a fresh EventsParser instance parsing a previously-saved
    # snapshot blob (e.g. a retry in a separate process) -- self._blobs
    # won't exist, so parse() must fall back to re-splitting fetched.raw.
    _install_stub_kind()
    try:
        fetcher = _parser([{"name": "widget_events", "kind": "stub", "url": "https://example.com"}])
        fetched = fetcher.fetch()

        reparser = _parser([{"name": "widget_events", "kind": "stub", "url": "https://example.com"}])
        records = reparser.parse(FetchResult(
            raw=fetched.raw, content_type=fetched.content_type,
            url=fetched.url, http_code=fetched.http_code,
        ))
        assert records == [{
            "title": "widget_events", "content_hash": "widget_events",
            "raw": "blob-for-widget_events",
        }]
    finally:
        _remove_stub_kind()


def test_paused_source_is_not_fetched_at_all(capsys):
    """owner 2026-11-24: Tockify city_events (configs/moreno_valley_ca.json) is paused while we wait for permission: not even robots.txt is requested."""
    import json
    from pathlib import Path

    from scrapers.event_sources import EVENT_SOURCE_KINDS
    from scrapers.parsers.events import EventsParser

    cfg = json.loads((Path(__file__).resolve().parent.parent / "configs" / "moreno_valley_ca.json").read_text(encoding="utf-8"))
    src = next(s for s in cfg["data_sources"]["events"]["sources"] if s["name"] == "city_events")
    assert src["paused"]["since"] == "2026-11-13"
    calls = []
    original = EVENT_SOURCE_KINDS["ical"]
    EVENT_SOURCE_KINDS["ical"] = type(original)(fetch=lambda s, h: calls.append(s["name"]), parse=original.parse)
    try:
        parser = EventsParser.__new__(EventsParser)
        parser.town_id, parser.source_cfg = "moreno_valley_ca", {"sources": [src]}
        parser.fetch()
    finally:
        EVENT_SOURCE_KINDS["ical"] = original
    assert calls == []
    assert "pausad sedan 2026-11-13" in capsys.readouterr().out
