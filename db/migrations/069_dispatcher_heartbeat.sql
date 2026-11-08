-- Heartbeat of the cron-dispatcher Worker's own jobs (owner decision 2026-11-08). The `events` table cannot show that the warnings fetch is alive
-- (rows are written only when a warning changes), so the Worker upserts last_ok here after each successful fetch per town and job, and records
-- last_error / last_error_at on a failure (last_ok untouched). scripts/check_freshness.py (GitHub's own schedule) opens an issue when last_ok is
-- older than 2 h (job 'alerts') or 3 h (job 'safety'). New table only, no existing data touched.
CREATE TABLE IF NOT EXISTS dispatcher_heartbeat (
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    job           TEXT NOT NULL,
    last_ok       TIMESTAMPTZ,
    last_error    TEXT,
    last_error_at TIMESTAMPTZ,
    PRIMARY KEY (town_id, job)
);
