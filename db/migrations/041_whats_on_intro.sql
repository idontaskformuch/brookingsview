-- What's On Phase 6b (Weekly Editorial Intro).
--
-- whats_on_intro: the optional AI-generated 2-3 sentence intro block shown
-- above /whats-on's Marquee section, one row per (town_id, ISO week).
-- Existence of a row for the CURRENT ISO week means the guardrailed AI
-- draft passed; ABSENCE (no row yet, an old week's row, or a guardrail
-- rejection) means the page renders with no block at all -- deliberately
-- no "generated_by='template_fallback'" row, same convention as
-- closure_watch_prose (db/migrations/030_closure_history.sql): "no row for
-- this week" and "guardrail rejected it" are the same, safe code path on
-- the read side. iso_year/iso_week (not a formatted slug) so the read side
-- can compare directly against site/src/lib/this-week.ts's own
-- currentWeekInfo() fields without string parsing.
--
-- Run once: psql "$DATABASE_URL" -f db/migrations/041_whats_on_intro.sql

BEGIN;

CREATE TABLE IF NOT EXISTS whats_on_intro (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    iso_year      INTEGER NOT NULL,
    iso_week      INTEGER NOT NULL,
    body          TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    generated_by  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, iso_year, iso_week)
);

COMMIT;
