-- "Free Things To Do" extension of /events/free/ (see Claude Code handoff
-- "Free Things To Do", v2 -- extend the existing page, don't fork a new
-- one). Both columns are populated by ai_pipeline/free_teasers.py, a new
-- ONE-TIME/evergreen pipeline shape distinct from every other digest here:
-- generated once per row and cached, never regenerated at Astro build
-- time (the site rebuilds hourly -- inline generation would re-pay for
-- the same sentence forever). Astro only ever reads these columns.
--
-- Deliberately plain nullable columns on the existing tables, not a new
-- join table -- each is a real 1:1 relationship (one teaser per facility,
-- one per event), same convention as project_updates.synthesis
-- (db/migrations/032_project_threads.sql).

BEGIN;

-- Only ever populated for the free-venue categories this page cares about
-- (library/park/community_center) -- see FREE_VENUE_CATEGORIES in both
-- site/src/lib/events.ts and ai_pipeline/free_teasers.py. NULL for every
-- other facility (city_hall, other) -- not every facility needs one.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS free_teaser TEXT;

-- Only ever populated for source_type='event' rows that resolve as free
-- per the same venue-category + paid-language check /events/free/ already
-- uses for filtering (ai_pipeline/free_teasers.py ports isFreeEvent() to
-- Python via the existing ai_pipeline/venue_registry.py). NULL for every
-- other story -- not a general-purpose column.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS free_teaser TEXT;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/036_free_teasers.sql
