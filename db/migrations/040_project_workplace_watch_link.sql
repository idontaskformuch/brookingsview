-- 040_project_workplace_watch_link.sql
--
-- Story Threads Phase 2 (per the ORIGINAL Story Threads handoff, distinct
-- from the Recurring-traffic layer's own phase numbering -- see that spec's
-- "Build phases" section, verbatim): "Cross-linking threads to Workplace
-- Watch or home-sales data where a project plausibly affects either."
--
-- The home-sales half of this already exists and predates Story Threads
-- entirely -- projects.home_sales_zip (see 023_city_hall_projects.sql),
-- hand-curated in data/projects/<town_id>.json, rendered on the project
-- page as a plain link, no automated matching. This column mirrors that
-- EXACT same pattern for the Workplace Watch half, rather than building
-- automated name-matching against `employers` -- every real entity link in
-- this codebase (facilities, employers, projects themselves) is hand-
-- curated by a human who has actually looked at both sides, never inferred
-- by fuzzy text matching against a title. NULL (the default) means "not
-- curated yet" or "genuinely doesn't apply" -- both real, honest, and
-- indistinguishable from each other by design (same as home_sales_zip).
--
-- No foreign key: employers is scoped by (town_id, slug), and this column
-- alone can't express that composite key any more cleanly than
-- home_sales_zip expresses one against a ZIP-code table that doesn't
-- exist -- same simple-TEXT convention, resolved by a plain JOIN at read
-- time (see site/src/lib/db.ts's getProjects()/getProjectBySlug()).

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workplace_watch_employer_slug TEXT;

COMMIT;
