"""Tests for ai_pipeline/new_in_town_digest.py (Handoff: Information Hub
Tier 1, Feature B -- New in Town). This is the riskiest of the three
features (real per-run cost, highest factual-error surface), so coverage
here is deliberately heavier than the other two: the two-source rule for
closures gets the most scrutiny, per explicit review guidance -- a single
wrongly-claimed closure is the kind of error a real business owner notices
and calls about, so "needs_review=true and nothing rendered" must be the
outcome of every ambiguous case, never a guess.
"""
import sys

from ai_pipeline import guardrails
from ai_pipeline.new_in_town_digest import (
    build_queries, build_roundup_source_text, roundup_template_fallback,
    preview_outcome, upsert_business, validate_record, _isoweek_slug, _roundup_hash, main,
)

RESULTS = [
    {"title": "The Daily Grind now open in Brookings", "description": "New coffee shop now open on Main Ave in Brookings, SD.", "url": "https://example.com/a"},
    {"title": "Fresh Cuts Barbershop coming soon", "description": "Opening in Brookings next month.", "url": "https://example.com/b"},
    {"title": "National Burger Co. opens in Sioux Falls", "description": "The chain's newest location is now open in Sioux Falls.", "url": "https://example.com/c"},
]

LOCATION_QUALIFIERS = ["Brookings SD", "Brookings South Dakota"]


# --- build_queries -----------------------------------------------------

def test_build_queries_combines_terms_and_qualifiers():
    feat = {"search_terms": ["new restaurant", "now open"], "location_qualifiers": ["Brookings SD"], "max_searches_per_run": 10}
    queries = build_queries(feat)
    assert "new restaurant Brookings SD" in queries
    assert "now open Brookings SD" in queries
    assert len(queries) == 2


def test_build_queries_caps_at_max_searches_per_run():
    feat = {"search_terms": ["a", "b", "c"], "location_qualifiers": ["X", "Y"], "max_searches_per_run": 3}
    queries = build_queries(feat)
    assert len(queries) == 3


# --- validate_record: every rejection path is a real named risk ----------

def test_rejects_invented_citation_not_in_real_results():
    record = {"name": "Ghost Cafe", "status": "opened", "source_url": "https://example.com/does-not-exist"}
    ok, reason = validate_record(record, RESULTS, LOCATION_QUALIFIERS)
    assert not ok
    assert "invented" in reason


def test_rejects_missing_name():
    record = {"name": "", "status": "opened", "source_url": "https://example.com/a"}
    ok, reason = validate_record(record, RESULTS, LOCATION_QUALIFIERS)
    assert not ok
    assert "name" in reason


def test_rejects_invalid_status():
    record = {"name": "The Daily Grind", "status": "renovating", "source_url": "https://example.com/a"}
    ok, reason = validate_record(record, RESULTS, LOCATION_QUALIFIERS)
    assert not ok
    assert "status" in reason


def test_rejects_chain_store_in_a_different_city():
    """The classic chain-noise case: a real, correctly-cited result, but for
    a location that isn't this town -- must be rejected even though the
    citation itself is completely legitimate."""
    record = {"name": "National Burger Co.", "status": "opened", "source_url": "https://example.com/c"}
    ok, reason = validate_record(record, RESULTS, LOCATION_QUALIFIERS)
    assert not ok
    assert "location-qualifier" in reason


def test_accepts_a_real_local_match_and_attaches_the_source_snippet():
    record = {"name": "The Daily Grind", "status": "opened", "source_url": "https://example.com/a"}
    ok, reason = validate_record(record, RESULTS, LOCATION_QUALIFIERS)
    assert ok, reason
    assert record["_source_snippet"] == RESULTS[0]["description"]


def test_accepts_comma_punctuated_city_state_in_the_snippet():
    """Real search snippets almost always write 'Brookings, SD' with a
    comma, but configs/<town>.json's location_qualifiers are bare
    'Brookings SD' -- an exact-substring match would wrongly reject every
    real local business over punctuation alone (a live bug this test caught
    before it could ship)."""
    results = [{"title": "New shop", "description": "Now open in Brookings, SD.", "url": "https://example.com/z"}]
    record = {"name": "Corner Shop", "status": "opened", "source_url": "https://example.com/z"}
    ok, reason = validate_record(record, results, LOCATION_QUALIFIERS)
    assert ok, reason


# --- upsert_business: the two-source rule for closures --------------------

class _FakeBizCursor:
    """Minimal fake matching exactly the SQL upsert_business() issues
    against local_businesses/local_business_sources -- same "fake the
    storage, run the real logic" approach as tests/test_search_budget.py."""
    def __init__(self, businesses: dict, sources: set, next_id: list):
        self.businesses = businesses  # id -> dict(name, status, source_url, needs_review, ...)
        self.sources = sources        # {(business_id, source_url)}
        self.next_id = next_id
        self._result = None
        self.rowcount = 0

    def execute(self, sql, params=()):
        norm = " ".join(sql.split())
        if norm.startswith("SELECT id, source_url, needs_review FROM local_businesses") or \
                norm.startswith("SELECT source_url, needs_review FROM local_businesses"):
            town_id, name, status = params
            match = next((b for b in self.businesses.values()
                          if b["town_id"] == town_id and b["name"] == name and b["status"] == status), None)
            self._result = dict(match) if match else None
        elif norm.startswith("INSERT INTO local_businesses"):
            town_id, name, category, status, address, source_url, source_name, reported_date, needs_review = params
            bid = self.next_id[0]
            self.next_id[0] += 1
            self.businesses[bid] = {
                "id": bid, "town_id": town_id, "name": name, "category": category, "status": status,
                "address": address, "source_url": source_url, "source_name": source_name,
                "reported_date": reported_date, "needs_review": needs_review,
            }
        elif norm.startswith("UPDATE local_businesses SET category"):
            category, address, source_url, source_name, reported_date, bid = params
            self.businesses[bid].update(category=category, address=address, source_url=source_url,
                                         source_name=source_name, reported_date=reported_date)
        elif norm.startswith("INSERT INTO local_business_sources"):
            bid, source_url, source_name, reported_date = params
            key = (bid, source_url)
            if key in self.sources:
                self.rowcount = 0
            else:
                self.sources.add(key)
                self.rowcount = 1
        elif norm.startswith("UPDATE local_businesses SET needs_review"):
            (bid,) = params
            self.businesses[bid]["needs_review"] = False
        else:
            raise AssertionError(f"unexpected SQL: {norm!r}")

    def fetchone(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeBizConn:
    def __init__(self):
        self.businesses: dict = {}
        self.sources: set = set()
        self.next_id = [1]

    def cursor(self, row_factory=None):
        return _FakeBizCursor(self.businesses, self.sources, self.next_id)

    def commit(self):
        pass


def _record(name="Ghost Cafe", status="closed", url="https://example.com/first", source_name="First Outlet"):
    return {"name": name, "status": status, "source_url": url, "source_name": source_name,
            "category": "restaurant", "address": None, "reported_date": None}


def test_first_closure_claim_is_pending_review_not_rendered():
    conn = _FakeBizConn()
    outcome = upsert_business(conn, "brookings_sd", _record())
    assert outcome == "inserted_pending_review"
    biz = next(iter(conn.businesses.values()))
    assert biz["needs_review"] is True


def test_a_second_different_source_corroborates_and_becomes_renderable():
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(url="https://example.com/first", source_name="First Outlet"))
    outcome = upsert_business(conn, "brookings_sd", _record(url="https://example.com/second", source_name="Second Outlet"))
    assert outcome == "corroborated_closure"
    biz = next(iter(conn.businesses.values()))
    assert biz["needs_review"] is False


def test_the_same_source_reappearing_is_not_a_second_source():
    """Regression guard for the exact failure this rule exists to prevent:
    the same article resurfacing in a later search must never be counted as
    independent corroboration."""
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(url="https://example.com/first"))
    outcome = upsert_business(conn, "brookings_sd", _record(url="https://example.com/first"))
    assert outcome == "duplicate_source_no_change"
    biz = next(iter(conn.businesses.values()))
    assert biz["needs_review"] is True, "must still be unrendered -- only one real source exists"


def test_a_third_source_after_confirmation_does_not_break_anything():
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(url="https://example.com/first"))
    upsert_business(conn, "brookings_sd", _record(url="https://example.com/second"))
    outcome = upsert_business(conn, "brookings_sd", _record(url="https://example.com/third"))
    assert outcome == "corroborated_closure" or outcome == "duplicate_source_no_change"
    biz = next(iter(conn.businesses.values()))
    assert biz["needs_review"] is False


def test_opened_status_never_needs_a_second_source():
    """The two-source rule is specifically for 'closed' -- a false 'opened'
    is a minor annoyance, not reputational harm to a named business."""
    conn = _FakeBizConn()
    outcome = upsert_business(conn, "brookings_sd", _record(status="opened"))
    assert outcome == "inserted_new"
    biz = next(iter(conn.businesses.values()))
    assert biz["needs_review"] is False


def test_opened_record_seen_again_just_refreshes_the_citation():
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(status="opened", url="https://example.com/first"))
    outcome = upsert_business(conn, "brookings_sd", _record(status="opened", url="https://example.com/updated"))
    assert outcome == "updated_existing"
    biz = next(iter(conn.businesses.values()))
    assert biz["source_url"] == "https://example.com/updated"


def test_closed_and_opened_claims_for_the_same_name_are_independent_rows():
    """A business could plausibly have both an 'opened' historical record
    and later a 'closed' claim -- these must not collide in the same row."""
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(status="opened"))
    upsert_business(conn, "brookings_sd", _record(status="closed"))
    assert len(conn.businesses) == 2


# --- preview_outcome: dry-run must be able to see what WOULD happen ------

def test_preview_matches_real_outcome_for_a_brand_new_opened_business():
    conn = _FakeBizConn()
    assert preview_outcome(conn, "brookings_sd", _record(status="opened")) == "inserted_new"
    assert len(conn.businesses) == 0, "preview must never write"


def test_preview_matches_real_outcome_for_a_first_closure_claim():
    conn = _FakeBizConn()
    assert preview_outcome(conn, "brookings_sd", _record(status="closed")) == "inserted_pending_review"
    assert len(conn.businesses) == 0


def test_preview_matches_real_outcome_for_a_corroborating_second_source():
    conn = _FakeBizConn()
    upsert_business(conn, "brookings_sd", _record(url="https://example.com/first"))
    outcome = preview_outcome(conn, "brookings_sd", _record(url="https://example.com/second"))
    assert outcome == "corroborated_closure"
    # Still real-only: the actual DB state must be untouched by the preview.
    assert next(iter(conn.businesses.values()))["needs_review"] is True


# --- roundup helpers ---------------------------------------------------

def test_roundup_source_text_includes_every_business_and_its_source():
    businesses = [
        {"name": "The Daily Grind", "category": "coffee shop", "status": "opened", "source_name": "Brookings Register"},
        {"name": "Old Mill Diner", "category": "restaurant", "status": "closed", "source_name": "Local Blog"},
    ]
    text = build_roundup_source_text(businesses)
    assert "The Daily Grind" in text and "Brookings Register" in text
    assert "Old Mill Diner" in text and "Local Blog" in text


def test_template_fallback_states_status_plainly_with_attribution():
    businesses = [{"name": "The Daily Grind", "status": "opened", "source_name": "Brookings Register"}]
    text = roundup_template_fallback(businesses, {"display_name": "Brookings"})
    assert "The Daily Grind opened" in text
    assert "Brookings Register" in text


def test_isoweek_slug_is_stable_format():
    import datetime
    slug = _isoweek_slug(datetime.date(2026, 8, 28))
    assert slug == "2026-w35"


def test_roundup_hash_is_order_independent_but_content_sensitive():
    a = [{"name": "X", "status": "opened", "source_url": "u1"}, {"name": "Y", "status": "opened", "source_url": "u2"}]
    b = [{"name": "Y", "status": "opened", "source_url": "u2"}, {"name": "X", "status": "opened", "source_url": "u1"}]
    c = [{"name": "X", "status": "opened", "source_url": "u1"}]
    assert _roundup_hash(a) == _roundup_hash(b)
    assert _roundup_hash(a) != _roundup_hash(c)


# --- missing-key / disabled-feature: graceful skip, never a crash --------

def test_missing_brave_api_key_skips_gracefully(tmp_path, monkeypatch, capsys):
    cfg_path = tmp_path / "test_town.json"
    cfg_path.write_text(
        '{"town_id": "test_town", "display_name": "Test Town", "state": "SD", '
        '"features": {"new_in_town": {"enabled": true, "search_terms": ["new restaurant"], '
        '"location_qualifiers": ["Test Town SD"], "max_searches_per_run": 1, '
        '"monthly_request_ceiling": 10}}}',
        encoding="utf-8",
    )
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", ["new_in_town_digest.py", "--config", str(cfg_path)])
    result = main()  # must return cleanly, not raise, and never reach DATABASE_URL/psycopg
    assert result == 0
    assert "BRAVE_API_KEY" in capsys.readouterr().out


def test_disabled_feature_skips_gracefully(tmp_path, monkeypatch, capsys):
    cfg_path = tmp_path / "test_town.json"
    cfg_path.write_text(
        '{"town_id": "test_town", "display_name": "Test Town", "state": "SD", '
        '"features": {"new_in_town": {"enabled": false}}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "argv", ["new_in_town_digest.py", "--config", str(cfg_path)])
    result = main()
    assert result == 0
    assert "disabled" in capsys.readouterr().out


# --- possessive handling: verify reuse, not reimplementation --------------

def test_possessive_business_names_are_not_falsely_rejected_by_the_shared_fact_checker():
    """Handoff §0/§3.3: possessive-stripping must be REUSED from
    guardrails.py's existing _POSSESSIVE_RE/_TRAILING_APOSTROPHE_RE (fixed
    for Workplace Watch's 'Skechers U.S.A.'s'/'Deckers Brands'' cases), not
    reimplemented. This proves New in Town inherits it automatically simply
    by calling the shared guardrails.validate() -- no New-in-Town-specific
    possessive code exists or should exist."""
    src = "SOURCE: Skechers U.S.A. opened a new outlet. Deckers Brands closed its downtown store."
    text = "Skechers U.S.A.'s new outlet opened downtown, and Deckers Brands' store has closed."
    result = guardrails.validate(text, src, {"display_name": "Brookings", "state": "SD"})
    assert result.passed, result.violations
