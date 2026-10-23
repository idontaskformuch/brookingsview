-- Facility pages (Brookings AdSense review, 2026-10-23): two additive, nullable text columns so a
-- place page can say where to park and what to know before going, from the place's own official
-- source. NULL = not stated by the source (never guessed). No data is changed by this migration.
ALTER TABLE places
    ADD COLUMN IF NOT EXISTS parking_note TEXT,
    ADD COLUMN IF NOT EXISTS visit_notes TEXT;
