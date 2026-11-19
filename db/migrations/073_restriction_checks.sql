-- Fire and water restrictions from a CivicPlus Alert Center (Fas 5 source 1, owner 2026-11-19: Broomfield nr 1 + 5, same code).
-- One row per check and kind (append-only log): the site reads the newest row per kind and the newest row whose state is not
-- 'unknown' (site/src/lib/restrictions.ts). A failed fetch or a page whose structure no longer matches writes an 'unknown' row,
-- so "the last check failed" and "when we last read it successfully" are both facts in the table, not guesses.
--   state   active  = the category page lists one or more alerts; `alerts` holds every one, newest first ({title, since_text,
--                     since_at, url}, the source's own words verbatim); title/since_text/since_at repeat the newest one
--           none    = the category page loaded, its own counter says 0 alerts and lists none (never a fallback: see the parser)
--           unknown = fetch refused/failed, or the page did not have the structure the parser checks for (error says which)
--   alert_sent_at  set on the 'unknown' row whose run sent the 72 h ntfy alert, so each unknown streak alerts once (the
--                  parser's after_upsert, owner 2026-11-19). The only column the scraper writes after the insert.
-- Written by scrapers/parsers/alert_center_restrictions.py only. No AI step reads or writes this table.
-- Apply: python -m scripts.apply_migration 073_restriction_checks --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup
-- first, the owner's own yes: CLAUDE.md rule 14)
CREATE TABLE IF NOT EXISTS restriction_checks (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    kind          TEXT NOT NULL CHECK (kind IN ('fire', 'water')),
    state         TEXT NOT NULL CHECK (state IN ('active', 'none', 'unknown')),
    title         TEXT,
    since_text    TEXT,
    since_at      TIMESTAMPTZ,
    alert_count   INT,
    alert_url     TEXT,
    alerts        JSONB,
    source_url    TEXT NOT NULL,
    checked_at    TIMESTAMPTZ NOT NULL,
    error         TEXT,
    alert_sent_at TIMESTAMPTZ,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    content_hash  TEXT NOT NULL,
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_restriction_checks_town_kind
    ON restriction_checks (town_id, kind, checked_at DESC);
