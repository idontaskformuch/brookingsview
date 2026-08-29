-- Follow-up to 032_project_threads.sql, caught before any traffic-sourced
-- row was ever inserted: project_updates' existing UNIQUE (project_id,
-- meeting_id, agenda_counter) constraint does nothing for a traffic row,
-- where meeting_id is NULL -- Postgres treats NULL as distinct from NULL in
-- uniqueness, so re-running ai_pipeline/traffic_project_updates.py against
-- the same still-open incident would insert a duplicate row every time
-- instead of upserting in place.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_updates_traffic_unique
    ON project_updates (project_id, traffic_incident_id)
    WHERE traffic_incident_id IS NOT NULL;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/033_project_updates_traffic_unique.sql
