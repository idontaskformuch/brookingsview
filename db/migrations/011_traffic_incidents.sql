-- 011_traffic_incidents.sql
--
-- Trafikincidenter/vägavstängningar/vägarbeten per ort. Källa varierar per
-- ort -- se scrapers/parsers/traffic_v1.py:
--   moreno_valley_ca: Caltrans QuickMap (quickmap.dot.ca.gov), en HELT ÖPPEN,
--     nyckelfri KML-feed (lane closures + CHP-incidenter), geografiskt
--     filtrerad till Moreno Valley-området i parsern.
--   brookings_sd: INGEN öppen källa hittad än (SD511.org har ingen publik
--     developer-portal; sdgis.sd.gov ArcGIS-tjänsten gick inte att nå från
--     den här miljön). enabled=false i configen tills en riktig källa
--     hittas -- se configens school_alerts-mönster för samma
--     "enabled=false + tydlig _notes" -princip.
--
-- external_incident_id  källans egna id (Caltrans Closure ID+Log Number,
--                        eller CHP:s eget incident-id, t.ex. "260810SA0164")
--                        -- båda stabila, samma "riktigt id > hash"-princip
--                        som school_alerts (migration 010).
-- severity               fri text från källan där sådan finns (Caltrans har
--                        ingen egen allvarlighetsgrad -- 'closure' vs
--                        'incident' via incident_type räcker för v1, severity
--                        finns som kolumn för framtida bruk/andra källor).
-- ends_at                NULL om okänt (många CHP-incidenter saknar
--                        uppskattat sluttid) -- widgeten filtrerar då på
--                        senast-sedd (last_seen_at) i stället, se
--                        lib/db.ts:getActiveTrafficIncidents.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/011_traffic_incidents.sql

BEGIN;

CREATE TABLE IF NOT EXISTS traffic_incidents (
    id                  BIGSERIAL PRIMARY KEY,
    town_id             TEXT NOT NULL REFERENCES towns(town_id),
    incident_type       TEXT NOT NULL,          -- 'lane_closure' | 'chp_incident'
    title               TEXT NOT NULL,
    description         TEXT,
    road                TEXT,
    severity            TEXT,
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,
    starts_at           TIMESTAMPTZ,
    ends_at             TIMESTAMPTZ,
    last_seen_at        TIMESTAMPTZ NOT NULL,
    source              TEXT NOT NULL,          -- 'caltrans_quickmap'
    external_incident_id TEXT NOT NULL,
    raw_data            JSONB,
    content_hash        TEXT NOT NULL,
    snapshot_id         BIGINT REFERENCES source_snapshots(id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, external_incident_id)
);
CREATE INDEX IF NOT EXISTS idx_traffic_incidents_town_seen ON traffic_incidents (town_id, last_seen_at DESC);

COMMIT;
