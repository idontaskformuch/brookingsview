-- Brookings View — databasschema (Postgres / Neon)
-- Byggt för att skala till flera orter (multi-tenant via town_id) och för att göra
-- de retrofit-dyra sakerna rätt från början: proveniens, källsnapshots, dedup,
-- körningslogg för händelsestyrt underhåll.
--
-- MEDVETET UTELÄMNAT: inga jail-/arrest-/booking- eller obituary-tabeller.
-- Vi lagrar aldrig anklagande innehåll om namngivna privatpersoner.

BEGIN;

-- ---------------------------------------------------------------------------
-- Orter (en rad per stad; nästa ort = ny config + ny rad, ingen kodändring)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS towns (
    town_id       TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    state         TEXT NOT NULL,
    county        TEXT,
    population     INT,
    domain        TEXT,
    timezone      TEXT DEFAULT 'America/Chicago',
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Källsnapshots: rå HTML/PDF/JSON exakt som den hämtades.
-- Två syften: (1) bevis på vad källan sa (försvar mot "AI:n hittade på"),
-- (2) upptäck när en .gov-sajt ändrar struktur (hash diffar).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    source_key    TEXT NOT NULL,          -- t.ex. "city_permits", "sdsu_athletics"
    url           TEXT,
    content_type  TEXT,                   -- "text/html", "application/pdf", "application/json"
    raw           BYTEA,                  -- rådata
    content_hash  TEXT NOT NULL,          -- sha256 av raw
    fetched_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_town_source
    ON source_snapshots (town_id, source_key, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- Körningslogg: en rad per scraper-körning. Driver alerting (larma när en
-- källa failar N gånger i rad) så underhåll blir händelsestyrt, inte dagligt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_runs (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    source_key    TEXT NOT NULL,
    status        TEXT NOT NULL,          -- 'ok' | 'error' | 'stub' | 'skipped'
    http_code     INT,
    items_found   INT DEFAULT 0,
    items_new     INT DEFAULT 0,
    error         TEXT,
    started_at    TIMESTAMPTZ DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_town_source_time
    ON scrape_runs (town_id, source_key, started_at DESC);

-- ---------------------------------------------------------------------------
-- Innehållstabeller. Varje rad har content_hash för dedup (samma möte/lov/
-- event skapar inte dubbletter) och raw_data (JSONB) med källans strukturerade
-- fält. Guardrails/AI-lagret läser raw_data för att validera genererad text.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meetings (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    body          TEXT,                   -- "City Council", "County Commission", "School Board"
    meeting_date  TIMESTAMPTZ,
    agenda_url    TEXT,
    minutes_url   TEXT,
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_meetings_town_date ON meetings (town_id, meeting_date DESC);

CREATE TABLE IF NOT EXISTS permits (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    permit_type   TEXT,                   -- "building", "business_license", "liquor_license"
    address       TEXT,
    description   TEXT,
    applicant     TEXT,                   -- företag/entitet, ALDRIG negativt om privatperson
    issued_date   DATE,
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_permits_town_date ON permits (town_id, issued_date DESC);

CREATE TABLE IF NOT EXISTS events (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    title         TEXT,
    starts_at     TIMESTAMPTZ,
    ends_at       TIMESTAMPTZ,
    venue         TEXT,
    source        TEXT,                   -- "parks_rec", "library", "sdsu_events"
    url           TEXT,
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_events_town_start ON events (town_id, starts_at);

CREATE TABLE IF NOT EXISTS sports_games (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    sport         TEXT,                   -- "football", "mbball", "wbball"
    opponent      TEXT,
    home_away     TEXT,
    starts_at     TIMESTAMPTZ,
    venue         TEXT,
    result        TEXT,                   -- null tills spelad
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_sports_town_start ON sports_games (town_id, starts_at);

CREATE TABLE IF NOT EXISTS weather_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    observed_for  DATE,
    payload       JSONB,                  -- normaliserad NOAA-prognos
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, observed_for)
);

CREATE TABLE IF NOT EXISTS ag_prices (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    commodity     TEXT,                   -- "corn", "soybeans", "cattle"
    price         NUMERIC,
    unit          TEXT,
    as_of         DATE,
    raw_data      JSONB,
    content_hash  TEXT NOT NULL,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, content_hash)
);

-- ---------------------------------------------------------------------------
-- Stories: den publicerbara, AI-formaterade (eller templatade) texten.
-- Proveniens inbyggd: source_url + snapshot_id + generated_by + verified.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    title         TEXT NOT NULL,
    slug          TEXT NOT NULL,
    body          TEXT NOT NULL,
    source_type   TEXT,                   -- "meeting" | "permit" | "event" | "sports" | "weather" | "ag"
    source_url    TEXT,
    snapshot_id   BIGINT REFERENCES source_snapshots(id),
    generated_by  TEXT,                   -- "ai:claude-sonnet-5" | "template"
    verified      BOOLEAN DEFAULT FALSE,  -- passerade guardrails
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_stories_town_pub ON stories (town_id, published_at DESC);

COMMIT;
