-- 010_school_alerts.sql
--
-- Skoldistriktens egna meddelanden (stängningar, försenad start, nödlägen,
-- men även vanliga notiser -- se is_closure nedan) för Brookings School
-- District 05-1 och Moreno Valley Unified School District. Ett district har
-- INGEN dedikerad "closures"-sida hos någotdera distriktet (verifierat via
-- direkt research 2026-08-10, se scrapers/parsers/school_alerts_v1.py) --
-- båda källorna är distriktets ALLMÄNNA meddelandeflöde (Brookings: en öppen
-- Thrillshare "live_feeds"-JSON-API; Moreno Valley: en Finalsite-nyhetslista
-- via HTML). is_closure flaggar deterministiskt (nyckelordsmatchning i
-- parsern, ingen AI) vilka poster som ser ut att röra stängning/försening/
-- nödläge, så frontend kan visa en banner bara för DE posterna utan att
-- filtrera bort resten av det som skrapas.
--
-- external_alert_id  källans egna, stabila post-id (Thrillshare live_feed-id
--                    respektive Finalsite data-post-id) -- BÅDA källorna
--                    visade sig ha riktiga stabila id:n vid research, så
--                    konflikmålet är (town_id, external_alert_id), inte en
--                    hash av (district+message+date) som annars vore nästa
--                    bästa val för en källa utan egna id:n.
-- message            distriktets EGEN formulering, oparafraserad -- se
--                    parserns moduldocstring för varför AI-lagret aldrig rör
--                    den här tabellen (ordalydelsen i en nödmeddelande-text
--                    är inte något att skriva om).
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/010_school_alerts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS school_alerts (
    id                BIGSERIAL PRIMARY KEY,
    town_id           TEXT NOT NULL REFERENCES towns(town_id),
    district          TEXT NOT NULL,
    external_alert_id TEXT NOT NULL,
    title             TEXT,
    message           TEXT NOT NULL,
    url               TEXT,
    posted_at         TIMESTAMPTZ NOT NULL,
    is_closure        BOOLEAN NOT NULL DEFAULT FALSE,
    source            TEXT NOT NULL,          -- 'thrillshare_live_feed' | 'finalsite_news'
    raw_data          JSONB,
    content_hash      TEXT NOT NULL,
    snapshot_id       BIGINT REFERENCES source_snapshots(id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, external_alert_id)
);
CREATE INDEX IF NOT EXISTS idx_school_alerts_town_posted ON school_alerts (town_id, posted_at DESC);

COMMIT;
