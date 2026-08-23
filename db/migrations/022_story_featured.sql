-- 022_story_featured.sql
--
-- Manual-curation escape hatch for the homepage "Worth knowing" block (see
-- NEEDS-HUMAN-REVIEW.md "Homepage Curation"): the block's selection is
-- otherwise entirely rule-based (source_type IN meeting/meeting_followup,
-- or an unbannered alert), but a human occasionally needs to flag
-- something that doesn't fit either category. Default false on every
-- existing row -- nothing is retroactively featured by adding this
-- column. No UI to set it yet (out of scope for this pass, per the
-- brief's own note) -- set it by hand:
--   UPDATE stories SET featured = true WHERE town_id = '...' AND slug = '...';

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

COMMIT;
