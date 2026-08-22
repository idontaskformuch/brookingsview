-- 019_property_sales_ingest_metadata.sql
--
-- Quarterly-aware home sales ingestion (see NEEDS-HUMAN-REVIEW.md, "Sept 2025
-- home-sales gap" -> resolved as a recording-latency artifact, not a bug).
--
-- 1. Explicit pin/doc_number/record_date columns (previously only inside
--    raw_data JSONB). (PIN, DocumentNumber) is a verified-unique identity per
--    physical unit sold (checked against live data: zero collisions across
--    2610 existing rows) -- more stable than the old content_hash(doc_number,
--    address) key, which breaks if the source file's address formatting ever
--    shifts between quarterly pulls. Re-pulling the same or an overlapping
--    window is now a real upsert (ON CONFLICT ... DO UPDATE, see
--    scrapers/parsers/rivco_property_sales_v1.py), not just dedup-by-hash.
--
-- 2. property_sales_ingests: one row per reconcile run, recording which
--    quarterly file was used and how far its data actually reaches
--    (window_end = max RecordDate seen COUNTYWIDE in the file, before the
--    Moreno Valley filter -- the town-filtered max is NOT a reliable "how far
--    does the county's data reach" signal, since a genuinely-zero month would
--    make it look like coverage stopped early). This is the sole source of
--    truth for classifying a month as "not yet released" vs "released, zero
--    qualifying sales" -- see ai_pipeline/home_sales_state.py.
--
-- Run once:  psql "$DATABASE_URL" -f db/migrations/019_property_sales_ingest_metadata.sql

BEGIN;

ALTER TABLE property_sales
    ADD COLUMN IF NOT EXISTS pin TEXT,
    ADD COLUMN IF NOT EXISTS doc_number TEXT,
    ADD COLUMN IF NOT EXISTS record_date DATE;

UPDATE property_sales
   SET pin = raw_data->>'PIN',
       doc_number = raw_data->>'DocumentNumber',
       record_date = NULLIF(raw_data->>'RecordDate', '')::date
 WHERE pin IS NULL AND raw_data ? 'PIN';

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_sales_identity
    ON property_sales (town_id, pin, doc_number);

CREATE TABLE IF NOT EXISTS property_sales_ingests (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    source_file    TEXT NOT NULL,
    file_mtime     TIMESTAMPTZ,
    window_start   DATE,   -- earliest RecordDate, countywide, in the source file
    window_end     DATE,   -- latest RecordDate, countywide -- the "how far does this pull reach" signal
    rows_seen      INT NOT NULL DEFAULT 0,   -- countywide rows in the file
    rows_matched   INT NOT NULL DEFAULT 0,   -- rows kept after city/residential/consideration filtering
    rows_inserted  INT NOT NULL DEFAULT 0,
    rows_updated   INT NOT NULL DEFAULT 0,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_sales_ingests_town
    ON property_sales_ingests (town_id, ingested_at DESC);

COMMIT;
