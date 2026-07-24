-- 006_property_sales.sql
--
-- Ny tabell för "Recent home sales" (Moreno Valley, Riverside County Assessor).
-- Samma form som meetings/sports_games/ag_prices: content_hash för dedup,
-- raw_data för allt annat, UNIQUE(town_id, content_hash) så omkörningar är säkra.
--
-- address     gatuadress (eller kvartersnivå -- se _notes i configen). ALDRIG
--             köpar-/säljarnamn, även om källfilen har dem -- samma princip som
--             compliance-blocket i configen redan kräver för andra källor.
--             Namn stannar i raw_data (databokföring), stripas innan AI-prompten
--             precis som _INTERNAL_FIELDS i ai_pipeline/publish.py.
-- sale_price  NUMERIC, dollar.
-- sale_date   DATE (inte TIMESTAMPTZ -- källan har bara datum, ingen tid).
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/006_property_sales.sql

BEGIN;

CREATE TABLE IF NOT EXISTS property_sales (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    address       TEXT,
    sale_price    NUMERIC,
    sale_date     DATE,
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_property_sales_town_date ON property_sales (town_id, sale_date DESC);

COMMIT;
