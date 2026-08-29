-- Follow-up to 034_stories_meeting_id.sql -- run ONLY after
-- scripts/resolve_duplicate_meeting_slugs.py has resolved the 77 existing
-- duplicate pairs (this index creation will fail with a uniqueness
-- violation otherwise, by design -- that failure is the safety check that
-- the cleanup actually ran first).
--
-- This is what "stops future duplicates" for real: even if
-- ai_pipeline/publish.py's own known_meeting_ids check (added alongside
-- this) has a bug or gets bypassed, the database itself now refuses a
-- second stories row for a meeting_id that already has one.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_meeting_id_unique
    ON stories (town_id, meeting_id)
    WHERE meeting_id IS NOT NULL;

COMMIT;

-- Run once, AFTER the cleanup script: psql "$DATABASE_URL" -f db/migrations/035_stories_meeting_id_unique.sql
