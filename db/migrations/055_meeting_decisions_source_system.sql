-- Phase 7, AgendaLink generalization (Broomfield) -- Migration A of 2 (see
-- Migration B, db/migrations/056_meeting_decisions_source_system_check.sql,
-- for the CHECK + UNIQUE). Split deliberately: the CHECK that follows would
-- reject every row the CURRENT ai_pipeline/meeting_decisions_legistar.py
-- writes today (it doesn't set source_system/source_item_id yet), which
-- would silently stop Brookings' scheduled decision updates the moment
-- this ran. That ingest code is updated first (to always set both fields),
-- verified against a real scheduled run, THEN Migration B adds the CHECK.
--
-- event_item_id's TYPE, VALUES and UNIQUE constraint are all left exactly
-- as they are -- only its NOT NULL is dropped, so a future non-Legistar
-- row (AgendaLink has no such numeric id) can simply leave it NULL.

BEGIN;

ALTER TABLE meeting_decisions
    ALTER COLUMN event_item_id DROP NOT NULL;

ALTER TABLE meeting_decisions
    ADD COLUMN IF NOT EXISTS source_system   TEXT,
    ADD COLUMN IF NOT EXISTS source_item_id  TEXT;

UPDATE meeting_decisions
   SET source_system  = 'legistar',
       source_item_id = event_item_id::text
 WHERE source_system IS NULL;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/055_meeting_decisions_source_system.sql
