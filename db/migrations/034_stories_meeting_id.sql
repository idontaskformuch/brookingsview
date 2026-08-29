-- AdSense remediation Phase B1: duplicate meeting slugs. Root cause
-- (confirmed via git history, not speculation): ai_pipeline/publish.py's
-- dedup key was the COMPUTED SLUG STRING (`known_slugs`, a full rescan of
-- `stories.slug` each run), not the underlying meetings.id. When the
-- "SEO Fas 5" dated-slug feature shipped (commit 996529e), every already-
-- published meeting with a non-null meeting_date got reprocessed on the
-- next publish run, computed a NEW dated slug string that wasn't in
-- known_slugs yet, and got a SECOND stories row inserted for the exact
-- same meeting. Confirmed live 2026-08-29: 77 such duplicate pairs exist
-- (64 Brookings, 13 Moreno Valley, 0 Broomfield), always exactly 2 rows
-- per meeting, never more.
--
-- `stories` had no column referencing `meetings.id` at all before this --
-- the only way to recover it was parsing the slug's trailing digits
-- (still done at render time in a couple of places, e.g.
-- site/src/lib/db.ts's getProjectForMeetingId() -- that's fine and stays,
-- it's just not a substitute for a real dedup key at insert time).
--
-- This migration only adds the column and backfills it -- it deliberately
-- does NOT add a uniqueness constraint yet, since the 77 existing
-- duplicate pairs would violate one immediately. See
-- scripts/resolve_duplicate_meeting_slugs.py for the one-time cleanup
-- (keeps the dated-slug row per pair, per the "dated scheme is canonical"
-- decision, 301s the legacy slug) and
-- db/migrations/035_stories_meeting_id_unique.sql for the constraint that
-- can only go on AFTER that cleanup runs.

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS meeting_id BIGINT REFERENCES meetings(id);

-- Backfill from the existing slug shape for meeting-sourced rows only --
-- "meeting-11179" or "meeting-2026-06-16-11179" both end in the real id.
-- meeting_followup uses its own separate id scheme (see
-- ai_pipeline/meeting_followups.py) and is deliberately NOT backfilled
-- here -- it was never part of the SEO Fas 5 dated-slug change and isn't
-- part of the duplicate-slug bug this migration fixes.
UPDATE stories
   SET meeting_id = (regexp_match(slug, '-(\d+)$'))[1]::bigint
 WHERE source_type = 'meeting'
   AND meeting_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_stories_meeting_id ON stories (meeting_id) WHERE meeting_id IS NOT NULL;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/034_stories_meeting_id.sql
