-- Makes each ai_pipeline/project_updates.py run's own stats visible from
-- the DB alone (owner decision 2026-10-14) -- without this, confirming
-- "how many AI calls did the scheduled run make" requires reading the
-- GitHub Actions log directly, which isn't always convenient. Additive
-- ALTER on project_updates_runs (migration 056) -- new columns only, all
-- with a DEFAULT so existing rows (there are none yet) would be
-- unaffected either way.

BEGIN;

ALTER TABLE project_updates_runs
    ADD COLUMN IF NOT EXISTS ai_calls           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS meetings_processed INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS meetings_skipped   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cap_hit            BOOLEAN NOT NULL DEFAULT false;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/057_project_updates_runs_counters.sql
