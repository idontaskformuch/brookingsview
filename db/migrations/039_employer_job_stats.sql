-- 039_employer_job_stats.sql
--
-- Recurring-traffic layer, Fas 4a: hiring layer on top of Workplace Watch,
-- joining the already-live Adzuna `jobs` feed to the existing hand-curated
-- `employers` roster (see 016_workplace_watch.sql).
--
-- `aliases` on employers: `jobs.company` is Adzuna's raw employer-supplied
-- string, which is very often a legal-entity/subsidiary name rather than the
-- consumer-facing brand ("Amazon.com Services LLC", not "Amazon"). Matching
-- is EXACT-after-normalization against name + aliases (see
-- ai_pipeline/guardrails.py's `_norm()`, reused here rather than a new
-- matcher) -- deliberately NOT a substring match, since a short employer
-- name ("Ball" of Ball Corporation) risks a false-positive substring hit
-- against an unrelated company name. Additive, human-curated, same
-- "no guessing -- only real observed forms" discipline as
-- facilities.name_aliases (scripts/seed_facility_name_aliases.py): default
-- empty array is correct and honest for an employer with no confirmed
-- variant forms yet, not a gap to silently paper over.
--
-- employer_job_stats: one row per employer per calendar month, written by
-- ai_pipeline/workplace_watch_digest.py's existing monthly run (same
-- period/upsert shape as employer_ratings) -- `posting_count` is the number
-- of jobs rows matching that employer whose posted_at falls in the
-- script's own lookback window at the time the digest ran ("openings now"
-- is a disclosed, sourced approximation of live status, not a real-time
-- feed -- jobs itself is append-only, see scrapers/parsers/jobs_v1.py, so a
-- row's mere presence never means "still open today"). "Change vs last
-- month" and "biggest mover" are DERIVED IN SQL from this raw count at read
-- time (see site/src/lib/db.ts's getEmployerJobStats(), a LAG() window
-- function), never stored as a separate column -- unlike employer_ratings'
-- own precomputed rating_delta_vs_last_month, which this deliberately does
-- NOT mirror, per the handoff's own explicit "derived in SQL" instruction.

BEGIN;

ALTER TABLE employers ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS employer_job_stats (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    employer_id    BIGINT NOT NULL REFERENCES employers(id),
    period         DATE NOT NULL,
    posting_count  INTEGER NOT NULL,
    content_hash   TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, employer_id, period)
);
CREATE INDEX IF NOT EXISTS idx_employer_job_stats_latest
    ON employer_job_stats (town_id, period DESC);

COMMIT;
