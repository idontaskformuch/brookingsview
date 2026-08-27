-- 028_facility_image_attribution.sql
--
-- Real-photo venue images (see NEEDS-HUMAN-REVIEW.md, "Switch venue/category
-- images to real photos") -- Flux-generated images always read as
-- AI-generated for a SPECIFIC named building (unlike the generic content-
-- track illustrations, which are unaffected by this change). image_path/
-- image_alt (026_facility_images.sql) stay exactly as they are and now hold
-- a real downloaded photo instead of a generated one; these new columns are
-- the attribution metadata that photo's license actually requires.
--
-- image_source: 'wikimedia_commons' for now (see scripts/source_venue_images.py) --
-- free text, not an enum, since a resident-submitted photo or a different
-- source could show up later without a migration.
-- image_license: the license's own short name (e.g. "CC BY-SA 3.0", "Public
-- domain") -- stored VERBATIM from the source's metadata, never inferred or
-- assumed, since getting this wrong is a real legal/attribution problem, not
-- a cosmetic one.
-- image_attribution_text / image_attribution_url: the exact credit line and
-- link target to render under the image -- built once at sourcing time from
-- the source's own metadata (Commons' extmetadata.Artist/LicenseUrl), not
-- reconstructed later from image_license alone (a license name isn't enough
-- to rebuild "Photo by X, licensed CC BY-SA 3.0" -- the author name has to
-- come from the source too).
--
-- All four NULL for a facility with no image (most parks/community
-- centers -- unchanged) OR for a venue where Task 1's Commons search found
-- no real photo of that specific building (see image_needs_review below) --
-- resolveImage() already treats a NULL image_path as "fall through to the
-- category tier," so this doesn't need new fallback logic, just honest data.
--
-- image_needs_review: true when a venue could NOT be matched to a real photo
-- of that specific building and was left without one (see Task 4's
-- "flag rather than silently substitute a stock photo" rule) -- a punch
-- list for a human to revisit later (e.g. a resident-submitted photo), not
-- rendered anywhere on the site itself.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/028_facility_image_attribution.sql

BEGIN;

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_source TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_license TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_attribution_text TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_attribution_url TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_needs_review BOOLEAN NOT NULL DEFAULT false;

COMMIT;
