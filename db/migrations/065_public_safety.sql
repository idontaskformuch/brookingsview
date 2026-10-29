-- Public safety notices (owner-approved plan 2026-10-29, .claude/specs/public-safety.md): wildfires from NIFC WFIGS and the AirNow reading,
-- written every 15 minutes by the cron-dispatcher Worker (src/safety/), read by GET /api/safety. New table only, no existing data touched.
-- Kept apart from `events` on purpose: publish.py, weekly digests and the event lists read `events` and must never turn these into stories.
CREATE TABLE IF NOT EXISTS public_safety_notices (
    id           BIGSERIAL PRIMARY KEY,
    town_id      TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('fire', 'air')),
    external_id  TEXT NOT NULL,          -- WFIGS IrwinID; 'aqi' for the one air row per town
    title        TEXT NOT NULL,          -- the source's own incident name; never reworded
    url          TEXT,
    raw_data     JSONB NOT NULL,         -- only fields the source publishes (acres, containment, distance, AQI ...)
    observed_at  TIMESTAMPTZ,            -- the source's own "last modified" / observation time
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- last poll that still listed it; the API shows only rows seen recently
    ended_at     TIMESTAMPTZ,            -- set when a successful poll no longer lists it
    UNIQUE (town_id, kind, external_id)
);
CREATE INDEX IF NOT EXISTS public_safety_notices_live ON public_safety_notices (town_id, kind) WHERE ended_at IS NULL;
