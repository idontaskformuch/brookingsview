-- Image pool rotation (Addendum 2, 2026-09-09).
--
-- pickFromPool() (site/src/lib/images.ts) already picks a category-pool
-- image deterministically per item via a stable hash of the item's own
-- slug -- no flicker across rebuilds, no DB needed. What it doesn't
-- guarantee is even, round-robin coverage: two DIFFERENT stories newly
-- published close together can hash into the SAME pool slot by chance,
-- which reads as repetition once real readers show up. This table adds a
-- true incrementing counter per (town_id, category) so a NEWLY-encountered
-- story's category image is assigned the NEXT pool slot in sequence, not a
-- hash bucket -- while staying just as stable once assigned (see
-- stories.category_image_index below): assignment happens ONCE, the first
-- time a story is resolved with no image_path of its own and a real
-- category pool to draw from, and is never reassigned afterward.
--
-- last_index is an EVER-INCREMENTING counter, never modded against a pool
-- size here -- ai_pipeline/assign_category_image_rotation.py (the only
-- writer) has no reason to know how many images are in a pool (that lives
-- in site/src/config/category-images.ts, a TypeScript file, not the DB).
-- The read side (images.ts's resolveImage()) takes `stored_index %
-- pool.length` at resolve time instead, where pool.length is naturally
-- known -- this also means a pool that later grows or shrinks doesn't
-- invalidate any already-assigned index, it just wraps differently.
--
-- Deliberately keyed on (town_id, category) only, not per-item -- this
-- table tracks "which slot does the NEXT new story get"; stories.
-- category_image_index is what actually pins one specific story to one
-- specific slot forever.
--
-- Run once: psql "$DATABASE_URL" -f db/migrations/043_category_image_rotation.sql

BEGIN;

CREATE TABLE IF NOT EXISTS category_image_rotation (
    town_id     TEXT NOT NULL,
    category    TEXT NOT NULL,
    last_index  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (town_id, category)
);

-- NULL means "not yet assigned a rotation slot" -- every story that
-- predates this feature, one still resolving via tiers 1-3 (own image or a
-- venue image), or one in a category with no pool at all. resolveImage()
-- falls back to its existing stable per-item hash pick when this is NULL,
-- so a story is never left without an image while waiting for the
-- assignment script's next run -- see images.ts's own comment on this
-- column's read side.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS category_image_index INTEGER;

COMMIT;
