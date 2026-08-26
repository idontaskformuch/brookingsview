-- 025_image_alt.sql
--
-- Real alt text for a story's illustration, replacing the generic
-- 'Illustration for "<headline>"' template rendered when this is NULL
-- (see NEEDS-HUMAN-REVIEW.md, "Image pipeline overhaul"). Nullable, and
-- deliberately NOT backfilled for already-published rows -- this pipeline
-- change is forward-only, same as the rest of that handoff.
--
-- Populated from content._base.illustration_theme() -- the same title +
-- short body-summary text already generated (at zero extra AI cost) to
-- build the Flux image prompt, reused here as a real, content-specific
-- description rather than a literal AI-generated caption of the finished
-- image (which would need a second, new AI call this pass doesn't add).
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/025_image_alt.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_alt TEXT;

COMMIT;
