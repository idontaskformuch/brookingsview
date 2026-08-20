-- 016_workplace_watch.sql
--
-- "Worker Pulse" / Workplace Watch: tracks review-trend digests for the major
-- warehouse/logistics employers in a town (v1: Moreno Valley only). Two
-- tables, same split as facilities vs. stories:
--
--   employers        -- hand-curated list (name, links, accent color), same
--                        "human edits a JSON file, no scraper" pattern as
--                        facilities. See scripts/seed_employers.py and
--                        data/employers/<town_id>.json.
--   employer_ratings -- one row per employer per calendar month, written by
--                        ai_pipeline/workplace_watch_digest.py. Glassdoor/
--                        Indeed have no public API and block scraping, so
--                        this comes from a search-and-summarize pass (Brave
--                        Search snippets -> AI paraphrase, never a verbatim
--                        quote) rather than a direct scrape.
--
-- overall_rating is nullable ON PURPOSE: search snippets don't reliably
-- contain a parseable star rating. Showing "rating pending" is honest;
-- guessing a number is not -- same "never invent a fact" principle as
-- guardrails.py and facilities.verified_date.

BEGIN;

CREATE TABLE IF NOT EXISTS employers (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    slug           TEXT NOT NULL,
    name           TEXT NOT NULL,
    facility_type  TEXT NOT NULL,
    glassdoor_url  TEXT,
    indeed_url     TEXT,
    accent_color   TEXT,
    content_hash   TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, slug)
);

CREATE TABLE IF NOT EXISTS employer_ratings (
    id                          BIGSERIAL PRIMARY KEY,
    town_id                     TEXT NOT NULL REFERENCES towns(town_id),
    employer_id                 BIGINT NOT NULL REFERENCES employers(id),
    period                      DATE NOT NULL,
    overall_rating              NUMERIC,
    rating_source_note          TEXT,
    theme_summary               TEXT NOT NULL,
    rating_delta_vs_last_month  NUMERIC,
    content_hash                TEXT NOT NULL,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, employer_id, period)
);
CREATE INDEX IF NOT EXISTS idx_employer_ratings_latest
    ON employer_ratings (town_id, period DESC);

COMMIT;
