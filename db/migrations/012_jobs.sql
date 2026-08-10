-- 012_jobs.sql
--
-- Lokala jobbannonser via Adzuna Job Search API (api.adzuna.com), en källa
-- per ort (se scrapers/parsers/jobs_v1.py). Strukturerad data, ingen AI --
-- samma princip som traffic_incidents/regional_sports_games.
--
-- external_job_id     Adzunas eget, stabila annons-id -- konfliktmål
--                      (town_id, external_job_id), samma "riktigt id > hash"-
--                      princip som school_alerts/traffic.
-- salary_is_predicted  Adzuna anger detta explicit (många löner är
--                       maskinellt uppskattade, inte annonsörens egna
--                       siffror) -- visas separat i frontend, döljs inte.
-- description          TRUNKERAD (se _MAX_DESCRIPTION_CHARS i jobs_v1.py) --
--                       Adzuna-svaret innehåller redan en förkortad
--                       beskrivning, inte hela annonstexten; redirect_url
--                       pekar till hela annonsen hos Adzuna/arbetsgivaren.
--
-- DEDUP: append-only, som möten/event -- en jobbannons antas oföränderlig
-- källdata en gång skrapad (till skillnad från regional_sports_games/
-- traffic_incidents vars status legitimt ändras). Standard
-- ON CONFLICT (town_id, external_job_id) DO NOTHING (update_columns sätts
-- inte i parsern).
--
-- KVOT: Adzunas gratisnivå är ~1000 anrop/månad (~33/dag) -- se
-- scrapers/parsers/jobs_v1.py och runner.py:s refresh_minutes-spärr
-- (db.last_run_at) för hur ETT anrop/ort/dag garanteras trots att
-- scrape.yml/moval-scrape.yml kör varje timme.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/012_jobs.sql

BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
    id                  BIGSERIAL PRIMARY KEY,
    town_id             TEXT NOT NULL REFERENCES towns(town_id),
    external_job_id     TEXT NOT NULL,
    title               TEXT NOT NULL,
    company             TEXT,
    location            TEXT,
    category            TEXT,
    salary_min          NUMERIC,
    salary_max          NUMERIC,
    salary_is_predicted BOOLEAN,
    description         TEXT,
    redirect_url        TEXT,
    posted_at           TIMESTAMPTZ,
    source              TEXT NOT NULL DEFAULT 'adzuna',
    raw_data            JSONB,
    content_hash        TEXT NOT NULL,
    snapshot_id         BIGINT REFERENCES source_snapshots(id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, external_job_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_town_posted ON jobs (town_id, posted_at DESC);

COMMIT;
