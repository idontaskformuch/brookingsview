-- /help/ freshness (spec .claude/specs/help-resources.md Phase 2; owner order 2026-11-27): one row per help source
-- (scrapers/help_sources.SOURCES id), written by scripts/watch_sources.py help_freshness once a week per town.
-- http_status   the answer the page gave at the last check (NULL = no answer / refused, see note)
-- section_hash  sha256 of the page's visible text the last time it was re-read without a parse error; the next check compares
--               against it (same = bump last verified, different or NULL = re-read). Cleared on 404/410.
CREATE TABLE IF NOT EXISTS help_source_checks (
    source_id    TEXT PRIMARY KEY,
    town_id      TEXT NOT NULL,
    url          TEXT NOT NULL,
    http_status  INTEGER,
    note         TEXT,
    section_hash TEXT,
    checked_at   TIMESTAMPTZ NOT NULL
);
