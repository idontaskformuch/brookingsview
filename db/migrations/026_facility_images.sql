-- 026_facility_images.sql
--
-- Venue & Category Image Identity (see NEEDS-HUMAN-REVIEW.md): reused
-- per-place illustrations instead of a per-article generation cost.
-- `facilities` already exists (63 Moreno Valley + 35 Brookings rows, from
-- earlier GIS-import + hand-curated work) -- this just adds the columns
-- the new image-resolution pipeline needs.
--
-- image_path/image_alt: same shape as stories.image_path/image_alt
-- (025_image_alt.sql) -- NULL until a real, generated illustration is
-- actually seeded for that facility. Only a handful of named landmark
-- venues (city hall, library branches) get a bespoke image; every other
-- facility (most parks, community centers, etc.) stays NULL here and
-- falls through to the category-image tier in lib/images.ts's
-- resolveImage() -- never a fabricated per-park image.
--
-- name_aliases: every raw string form the scrapers actually emit for
-- this place (e.g. "MAIN LIBRARY", "MV MALL Library", "Moreno Valley
-- Public Library Mall Branch") -- the alias-matching table venue
-- resolution needs (see lib/images.ts's resolveVenueForImage(), which
-- deliberately reuses the SAME real venue link meetings/events already
-- have -- see facilities.aliases from db/migrations/020, a DIFFERENT
-- column already used for Event JSON-LD venue resolution. name_aliases
-- is kept separate rather than reusing `aliases` because the two serve
-- different matching rules: `aliases` matches a full LOCATION string
-- (title/address as a whole, comma-truncated), name_aliases matches
-- title-PREFIX text specifically (see NEEDS-HUMAN-REVIEW.md, "Venue &
-- Category Image Identity" for why title-prefix-only matching, not a
-- free-text body scan, is the deliberate anti-false-positive rule here).
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/026_facility_images.sql

BEGIN;

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_alt TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS name_aliases TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
