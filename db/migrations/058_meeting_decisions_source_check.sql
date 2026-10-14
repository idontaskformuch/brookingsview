-- Migration B of 2 (see db/migrations/055_meeting_decisions_source_system.sql
-- for Migration A). Run only after confirming meeting_decisions_legistar
-- has fired (scheduled or manual) with every row carrying source_system/
-- source_item_id -- otherwise this CHECK would reject every row the
-- CURRENT ingest code writes. Confirmed live 2026-10-14: all 84 existing
-- rows already satisfy both constraints below (0 NULLs, 0 duplicate
-- (source_system, source_item_id) pairs, 0 legistar rows missing
-- event_item_id) -- verified with a read-only SELECT immediately before
-- writing this file, not assumed.

BEGIN;

ALTER TABLE meeting_decisions
    ADD CONSTRAINT meeting_decisions_source_ref_check CHECK (
        source_system IS NOT NULL
        AND source_item_id IS NOT NULL
        AND (source_system <> 'legistar' OR event_item_id IS NOT NULL)
    ),
    ADD CONSTRAINT meeting_decisions_source_unique UNIQUE (source_system, source_item_id);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/058_meeting_decisions_source_check.sql
