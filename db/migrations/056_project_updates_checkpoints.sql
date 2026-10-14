-- Incremental processing for ai_pipeline/project_updates.py (owner decision
-- 2026-10-14): before this, every scheduled run rescanned EVERY historical
-- meeting and called the real Anthropic API for every unmatched candidate-
-- shaped agenda item every time, not just new ones -- unaffordable at any
-- real cadence. Two tables, two separate jobs:
--
--   project_updates_checkpoints -- lets the script skip ONE meeting
--   entirely once its agenda_items haven't changed since the last
--   successful (non-dry-run) pass. agenda_hash is NOT meetings.
--   content_hash -- that column is an IDENTITY hash (source+event_id+
--   date, see db/db.py's content_hash()), stable even when a meeting's
--   own agenda_items are later amended, so it can't detect a real content
--   change. agenda_hash here is computed fresh by the script itself from
--   the actual agenda_items payload. ON DELETE CASCADE: a checkpoint is
--   meaningless without its meeting -- without this, deleting a meeting
--   row (e.g. a future dedup cleanup) would fail on this FK instead.
--
--   project_updates_runs -- lets the script skip an ENTIRE run (no DB
--   scan, no AI calls at all) when called again too soon. Real-elapsed-
--   time based (last_success_at), not tied to which hour a cron fired --
--   a scheduled GitHub Actions run that starts late or gets skipped
--   entirely still self-paces correctly next time it does run, instead of
--   an hour-of-day check silently missing a whole day.

BEGIN;

CREATE TABLE IF NOT EXISTS project_updates_checkpoints (
    meeting_id   BIGINT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    agenda_hash  TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_updates_runs (
    town_id         TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ NOT NULL
);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/056_project_updates_checkpoints.sql
