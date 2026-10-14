-- Phase 7, AgendaLink generalization (Broomfield) -- additive, per owner
-- decision 2026-10-14. event_item_id's TYPE, VALUES and UNIQUE constraint
-- are all left exactly as they are -- only its NOT NULL is dropped, so a
-- non-Legistar row (AgendaLink has no such numeric id; its native per-topic
-- id is a Mongo-style hex string, see .claude/phase6-7-broomfield-research
-- .md §1) can simply leave it NULL instead of needing a synthesized value.
-- NULL is allowed to repeat under a UNIQUE constraint, so this is safe for
-- any number of future non-Legistar rows.
--
-- source_system/source_item_id identify a decision in ITS OWN system's
-- terms and are mandatory on every row (existing Legistar rows backfilled
-- below, not left NULL). event_item_id is required only when
-- source_system='legistar' -- enforced by the CHECK below, not just a
-- convention.

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

ALTER TABLE meeting_decisions
    ADD CONSTRAINT meeting_decisions_source_ref_check CHECK (
        source_system IS NOT NULL
        AND source_item_id IS NOT NULL
        AND (source_system <> 'legistar' OR event_item_id IS NOT NULL)
    ),
    ADD CONSTRAINT meeting_decisions_source_unique UNIQUE (source_system, source_item_id);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/055_meeting_decisions_source_system.sql
