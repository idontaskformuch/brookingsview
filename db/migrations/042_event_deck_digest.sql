-- Marquee deck sentences (presentation-layer follow-up, Part A).
--
-- event_deck_digest: the optional AI-generated one-sentence "deck" shown
-- under a marquee-tier Ticketmaster event's hero card on the front page and
-- /whats-on, one row per (town_id, ticketmaster_event_id). Ticketmaster
-- events themselves are still NOT persisted anywhere (site/src/lib/
-- ticketmaster.ts fetches Discovery API live at Astro build time, same as
-- always) -- this table only attaches a cached sentence to that feed's own
-- stable event id, looked up by a plain application-level join at build
-- time, same "no foreign key to an external id" convention as
-- 040_project_workplace_watch_link.sql.
--
-- Absence of a row (never generated, an event too sparse to ground a
-- sentence, or a guardrail rejection that survived retry) means the
-- marquee card simply renders with no deck line -- the same "absence is a
-- normal, safe state" convention as whats_on_intro/closure_watch_prose.
-- No "generated_by='template_fallback'" row exists for the same reason:
-- there's no safe generic template sentence for an event, only the real
-- grounded one or nothing.
--
-- content_hash is over THIS EVENT's own grounding fields (title, venue,
-- date, price, classification) -- NOT a global content_hash the way
-- whats_on_intro's is over a whole week's event-id set, since this table
-- tracks one event's own record changing (a price posted, a date shifted),
-- not "did the marquee lineup change." A row regenerates only when that
-- hash changes or the event is newly promoted into marquee tier -- never on
-- a timer, so cost stays bounded to a handful of events per town.
--
-- Run once: psql "$DATABASE_URL" -f db/migrations/042_event_deck_digest.sql

BEGIN;

CREATE TABLE IF NOT EXISTS event_deck_digest (
    id                    BIGSERIAL PRIMARY KEY,
    town_id               TEXT NOT NULL REFERENCES towns(town_id),
    ticketmaster_event_id TEXT NOT NULL,
    body                  TEXT NOT NULL,
    content_hash          TEXT NOT NULL,
    generated_by          TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, ticketmaster_event_id)
);

COMMIT;
