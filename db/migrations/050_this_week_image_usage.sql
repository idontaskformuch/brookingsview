-- 050_this_week_image_usage.sql
--
-- Weekly image rotation for the "This week" segment (homepage WeeklyRoundup
-- + /this-week/[week]/ archive), all three towns -- see NEEDS-HUMAN-REVIEW.md
-- "This Week image rotation". Previously the segment's image came from the
-- generic, shared 'events' category pool (lib/images.ts's CATEGORY_BY_
-- SOURCE_TYPE), 4-5 photos per town shared with every other event/alert/
-- meeting card sitewide -- confirmed live (2026-10-03) that this reads as
-- "always the same picture" even though it technically rotates through 4-5
-- generic, non-seasonal stock photos.
--
-- One row per (town_id, iso_year_week) -- the SAME selection every rebuild
-- that week reuses this row rather than re-rolling (unique constraint is
-- the actual mechanism for that, not application-level caching). iso_year_
-- week is the "2026-w40" slug lib/this-week.ts's WeekInfo.slug already uses
-- everywhere else in this codebase (ai_pipeline/weekly.py's own format) --
-- reused here rather than inventing a second week-identifier shape.
--
-- shown_at is a real timestamp (not just the iso_year_week string) because
-- the 60-day no-repeat rule is a ROLLING window against real elapsed time,
-- not a count of iso-weeks -- matters at year boundaries and for any future
-- backfill/replay where "60 days" and "8-9 iso-weeks" aren't quite the same
-- thing.

BEGIN;

CREATE TABLE IF NOT EXISTS this_week_image_usage (
  id BIGSERIAL PRIMARY KEY,
  town_id TEXT NOT NULL,
  iso_year_week TEXT NOT NULL,
  image_id TEXT NOT NULL,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (town_id, iso_year_week)
);

-- The 60-day exclusion query is WHERE town_id = ? AND shown_at >= now() -
-- interval '60 days' -- this index makes that a direct range scan instead
-- of a sequential scan as the table grows (one row per town per week,
-- indefinitely).
CREATE INDEX IF NOT EXISTS this_week_image_usage_town_shown_at_idx
  ON this_week_image_usage (town_id, shown_at);

COMMIT;
