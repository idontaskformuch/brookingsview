-- 051_event_series_supersede.sql
--
-- Events correctness Phase 1: before this migration, ai_pipeline/publish.py's
-- group_recurring_events() only grouped occurrences present TOGETHER in a
-- single run's events-table read -- it had no way to know about individual
-- occurrences already published as their OWN separate stories rows by an
-- earlier run, before enough of them existed at once to cross the
-- recurring-series threshold (or before that grouping existed at all). The
-- live result: a handful of recurring programs (e.g. Moreno Valley's "Shop
-- for a Cause Fundraiser") accumulated hundreds of near-duplicate individual
-- event cards alongside the one canonical is_recurring_series row the fixed
-- pipeline now correctly maintains going forward.
--
-- superseded_by_slug records, for an old individual row, which canonical
-- series story (stories.slug) it was retroactively merged into --
-- scripts/merge_recurring_event_duplicates.py sets this. "Keep data, stop
-- rendering": the row is never deleted, but every event-listing query now
-- filters AND superseded_by_slug IS NULL (see site/src/lib/db.ts's Story
-- interface, same column, for the full list of call sites). NULL for every
-- row this never applies to.

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS superseded_by_slug TEXT;

COMMIT;
