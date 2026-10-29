-- Weekly OpenStreetMap snapshot for the evening layer's "Open late" block (owner-approved 2026-10-29).
-- One row per town, replaced by scripts/refresh_osm_places.py (cron-dispatcher starts it on Mondays). The site build reads this row
-- and never calls Overpass; a missing row or one older than 14 days means no Open late block. New table only, no existing data touched.
CREATE TABLE IF NOT EXISTS osm_places (
    town_id    TEXT PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    radius_km  NUMERIC NOT NULL,
    -- Overpass elements cut down to {type, id, tags: {name, amenity, opening_hours, website, contact:website}}.
    elements   JSONB NOT NULL
);
