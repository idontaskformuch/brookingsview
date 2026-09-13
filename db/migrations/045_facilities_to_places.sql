-- 045_facilities_to_places.sql
--
-- Broomfield place-layer handoff, Step 2. Renames facilities -> places (one
-- source of truth, not a parallel table -- see NEEDS-HUMAN-REVIEW.md for the
-- full reasoning) and adds the new columns the handoff's own section 3.2
-- asks for -- MINUS the ones that already exist under a different name,
-- confirmed against the real schema before writing this migration:
-- phone/lat/lon/source_url are identical to what the spec asks for,
-- already present; website_url's job is already done by the existing
-- `website` column; last_verified_at's job is already done by the existing
-- `verified_date` column (DATE, not TIMESTAMPTZ -- coarser granularity,
-- already sufficient for the "checked <date>" display every facility page
-- already renders). place_type is deliberately NOT added -- the existing
-- `category` column is a different, WIDER, already load-bearing taxonomy
-- (FACILITY_CATEGORY_LABELS/FACILITY_SCHEMA_TYPE, the /facilities index
-- page's own grouping, "Always free" venue filtering) that Broomfield
-- already has real seeded rows against (police/fire_station/post_office/
-- animal_shelter/medical -- none of which the spec's own place_type list
-- even covers). Decided explicitly with the human, not silently invented:
-- extend `category`'s own label maps with the few genuinely missing values
-- instead of introducing a second, narrower, parallel taxonomy on the same
-- row.
--
-- Every genuinely new column here is nullable, per the handoff's own
-- explicit instruction -- Brookings and Moreno Valley's existing rows (and
-- every existing route/query reading them) are completely unaffected.
-- Index/constraint names are left as their old auto-generated
-- "facilities_..." names after the rename (e.g. facilities_pkey) --
-- cosmetic only, changing them is pure risk for zero functional benefit.

BEGIN;

ALTER TABLE facilities RENAME TO places;

ALTER TABLE places
    ADD COLUMN IF NOT EXISTS is_free BOOLEAN,
    ADD COLUMN IF NOT EXISTS fee_note TEXT,
    ADD COLUMN IF NOT EXISTS accessibility_note TEXT,
    ADD COLUMN IF NOT EXISTS services TEXT[],
    ADD COLUMN IF NOT EXISTS verification_method TEXT, -- 'scrape' | 'manual' | 'api'
    ADD COLUMN IF NOT EXISTS hours_confidence TEXT;     -- 'structured' | 'text_only' | 'unknown'

-- One row per regular weekly interval -- handoff section 3.3. A place may
-- have multiple rows per day (split hours, e.g. 9-12 and 13-17). Absence of
-- a row for a given day means UNKNOWN (never asked/sourced yet) -- never
-- rendered as "closed", which is the explicit, different meaning of
-- opens=closes=NULL (a real, sourced "closed that day" fact).
-- valid_from/valid_to are for seasonal ranges (e.g. summer-only pool
-- hours); NULL on both means the interval applies year-round.
CREATE TABLE IF NOT EXISTS place_hours (
    id          BIGSERIAL PRIMARY KEY,
    place_id    BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens       TIME,
    closes      TIME,
    valid_from  DATE,
    valid_to    DATE
);
CREATE INDEX IF NOT EXISTS idx_place_hours_place ON place_hours (place_id, day_of_week);

-- Holidays, seasonal closures, temporary closures -- always overrides the
-- regular weekly place_hours rows above for its own date. opens/closes
-- both NULL means closed all day. Handoff section 3.4.
CREATE TABLE IF NOT EXISTS place_hours_exceptions (
    id               BIGSERIAL PRIMARY KEY,
    place_id         BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    opens            TIME,
    closes           TIME,
    reason           TEXT,
    source_url       TEXT,
    last_verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_place_hours_exceptions_place_date ON place_hours_exceptions (place_id, date);

COMMIT;
