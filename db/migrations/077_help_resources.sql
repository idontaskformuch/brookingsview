-- /help/ step 1a (owner 2026-11-27, .claude/specs/help-resources.md + phase0-report "ÄGARENS BESLUT"). Extends places, no parallel
-- system. New categories (food_pantry, meal_program, warm_space, assistance_program, free_clinic) live in category; the rules for
-- them are in db/help_places.py (Python) and HELP_CATEGORIES in site/src/lib/db.ts. They have no detail page and stay out of the
-- /facilities/ hub and its sitemap (decision 4). No CHECK constraints: apply_migration refuses them; the values are checked in code.
-- last_verified_at = the existing verified_date; lat/lng = lat/lon; postal_district is derived from postal_code at render time.
ALTER TABLE places ADD COLUMN IF NOT EXISTS source_kind TEXT;           -- official | operator | other (other = candidate queue)
ALTER TABLE places ADD COLUMN IF NOT EXISTS verification_status TEXT;   -- verified | changed | stale | gone
ALTER TABLE places ADD COLUMN IF NOT EXISTS requirements_note TEXT;     -- verbatim line(s) from the source, "; "-separated
ALTER TABLE places ADD COLUMN IF NOT EXISTS area_name TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS valid_from DATE;            -- seasonal entries; hidden from the day after valid_to
ALTER TABLE places ADD COLUMN IF NOT EXISTS valid_to DATE;
ALTER TABLE places ADD COLUMN IF NOT EXISTS audience_tags TEXT[];       -- families | seniors | students | everyone
ALTER TABLE places ADD COLUMN IF NOT EXISTS schedule_rule TEXT;         -- a monthly pattern verbatim ("2nd and 4th Saturday"); decision 3:
                                                                        -- dated place_hours rows 8 weeks ahead are generated from it
-- Decision 2: a warm space on a place we already have (a library, a senior center) is a role, 'warm_space' in places.services,
-- with its own dates and its own source here. The place's own valid_from/valid_to are for the place; a library never expires
-- because the warming season ends. No ON DELETE action: apply_migration refuses the keyword; rows go with their place by hand.
CREATE TABLE IF NOT EXISTS place_roles (
    id                  BIGSERIAL PRIMARY KEY,
    place_id            BIGINT NOT NULL REFERENCES places (id),
    role                TEXT NOT NULL,
    valid_from          DATE,
    valid_to            DATE,
    source_url          TEXT NOT NULL,
    source_kind         TEXT,
    verification_status TEXT,
    verified_date       DATE,
    requirements_note   TEXT,
    schedule_text       TEXT,
    UNIQUE (place_id, role)
);
