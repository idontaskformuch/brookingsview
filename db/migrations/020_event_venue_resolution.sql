-- 020_event_venue_resolution.sql
--
-- Curated venue registry for Event JSON-LD (see NEEDS-HUMAN-REVIEW.md,
-- "Event JSON-LD venue resolution"). Google requires a real resolved
-- PostalAddress for rich-result eligibility -- we never synthesize one from
-- a scraped venue string, only match it against a hand-verified registry.
--
-- Reuses `facilities` (db/migrations/007_facilities.sql) as that registry --
-- one source of truth for an address instead of maintaining it twice:
--   aliases        every raw venue string seen in scraped events for this
--                  facility ("Main Library", "Main Branch Moreno Valley
--                  Public Library", ...) -- matched in addition to `name`.
--   street_address / postal_code: split out of the existing free-text
--                  `address` so a schema.org PostalAddress can be built
--                  without re-parsing it (addressLocality/addressRegion are
--                  NOT per-facility columns -- every facility in a town
--                  shares the same city/state, already in site-config).
--
-- `stories.venue_raw`: the event's raw scraped venue string, copied
-- verbatim at publish time (a fact about the source, like source_url) --
-- resolution against the registry happens at RENDER time (site/src/lib/
-- db.ts), never stored as a resolved id, so adding an alias to `facilities`
-- and rebuilding the site immediately re-resolves every previously-unmatched
-- event with no pipeline re-run needed.
-- `stories.is_recurring_series`: mirrors events.is_recurring_series (set by
-- ai_pipeline.publish.group_recurring_events) -- a series page has no
-- single real-world occurrence to attach Event JSON-LD to (see
-- NEEDS-HUMAN-REVIEW.md for why series pages skip Event markup entirely
-- rather than emit N competing Event objects on one URL).
--
-- `venue_review_queue`: every raw venue string that failed to resolve,
-- deduped by normalized form, with an occurrence count -- written once per
-- newly-published event (ai_pipeline/publish.py), never from the read-only
-- Astro build. A human works this list top-down (highest count first) to
-- prioritize which venues are worth adding to the registry.
--
-- Run once:  psql "$DATABASE_URL" -f db/migrations/020_event_venue_resolution.sql

BEGIN;

ALTER TABLE facilities
    ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS street_address TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE stories
    ADD COLUMN IF NOT EXISTS venue_raw TEXT,
    ADD COLUMN IF NOT EXISTS is_recurring_series BOOLEAN NOT NULL DEFAULT false,
    -- events.ends_at already exists (scrapers/parsers/events.py) but was
    -- never carried onto `stories` -- needed for Event JSON-LD's endDate.
    ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS venue_review_queue (
    id                BIGSERIAL PRIMARY KEY,
    town_id           TEXT NOT NULL REFERENCES towns(town_id),
    normalized_venue  TEXT NOT NULL,
    raw_examples      TEXT[] NOT NULL DEFAULT '{}',
    occurrence_count  INT NOT NULL DEFAULT 0,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- set true by a human once the venue's been added to `facilities` (as an
    -- alias) or judged permanently unresolvable (e.g. a garbage/non-venue
    -- string) -- excluded from the "what needs attention" view either way.
    resolved          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (town_id, normalized_venue)
);
CREATE INDEX IF NOT EXISTS idx_venue_review_queue_open
    ON venue_review_queue (town_id, occurrence_count DESC) WHERE NOT resolved;

COMMIT;
