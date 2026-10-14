-- Incremental processing for ai_pipeline/project_updates.py (owner decision
-- 2026-10-14): before this, every scheduled run rescanned EVERY historical
-- meeting and called the real Anthropic API for every unmatched candidate-
-- shaped agenda item every time, not just new ones -- unaffordable at any
-- real cadence. This table lets the script skip a meeting entirely once
-- its agenda_items haven't changed since the last successful (non-dry-run)
-- pass.
--
-- agenda_hash is NOT meetings.content_hash -- that column is an IDENTITY
-- hash (source+event_id+date, see db/db.py's content_hash()), stable even
-- when a meeting's own agenda_items are later amended, so it can't detect
-- a real content change. agenda_hash here is computed fresh by the script
-- itself from the actual agenda_items payload.

BEGIN;

CREATE TABLE IF NOT EXISTS project_updates_checkpoints (
    meeting_id   BIGINT PRIMARY KEY REFERENCES meetings(id),
    agenda_hash  TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/056_project_updates_checkpoints.sql
