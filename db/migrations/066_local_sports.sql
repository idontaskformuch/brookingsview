-- Local sports core (spec .claude/specs/local-sports-spec.md, Phase 0). New tables only; nothing existing is touched.
-- Kept apart from `sports_games` (SDSU) and `regional_sports_games`, which keep running until the `internal` / `mlb_stats` adapters replace them.
-- History is never deleted: old rows stop rendering, they stay.
-- Apply: python -m scripts.apply_migration 066_local_sports --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup first)
CREATE TABLE IF NOT EXISTS sport_programs (
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    id             TEXT NOT NULL,
    name           TEXT NOT NULL,
    short          TEXT,
    nickname       TEXT,
    color_primary  TEXT,
    color_secondary TEXT,
    home_venue     TEXT,
    level_default  TEXT CHECK (level_default IN ('pro','minor','college','varsity','jv','amateur','youth')),
    rival_ids      TEXT[] NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (town_id, id)
);

CREATE TABLE IF NOT EXISTS sport_events (
    id               BIGSERIAL PRIMARY KEY,
    town_id          TEXT NOT NULL REFERENCES towns(town_id),
    source           TEXT NOT NULL,
    source_uid       TEXT NOT NULL,
    program_id       TEXT,
    sport            TEXT NOT NULL,
    level            TEXT NOT NULL CHECK (level IN ('pro','minor','college','varsity','jv','amateur','youth')),
    gender           TEXT,
    competition      TEXT,
    home_program_id  TEXT,
    home_name        TEXT,
    away_program_id  TEXT,
    away_name        TEXT,
    start_at         TIMESTAMPTZ NOT NULL,
    tz               TEXT NOT NULL,
    venue            TEXT,
    status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','final','postponed','cancelled')),
    result_type      TEXT NOT NULL CHECK (result_type IN ('score','placing','time','none')),
    score_home       INTEGER,
    score_away       INTEGER,
    placing_text     TEXT,
    url              TEXT,
    first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, source, source_uid),
    FOREIGN KEY (town_id, program_id) REFERENCES sport_programs (town_id, id)
);
CREATE INDEX IF NOT EXISTS sport_events_town_start ON sport_events (town_id, start_at);
CREATE INDEX IF NOT EXISTS sport_events_program_start ON sport_events (town_id, program_id, start_at);

CREATE TABLE IF NOT EXISTS sport_standings (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    source        TEXT NOT NULL,
    competition   TEXT NOT NULL,
    season        TEXT NOT NULL,
    program_id    TEXT,
    team_name     TEXT NOT NULL,
    rank          INTEGER,
    played        INTEGER,
    won           INTEGER,
    drawn         INTEGER,
    lost          INTEGER,
    points        INTEGER,
    as_of         DATE NOT NULL,
    UNIQUE (town_id, source, competition, season, team_name, as_of),
    FOREIGN KEY (town_id, program_id) REFERENCES sport_programs (town_id, id)
);

CREATE TABLE IF NOT EXISTS sport_sources_health (
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    source_id     TEXT NOT NULL,
    last_success  TIMESTAMPTZ,
    last_error    TEXT,
    last_error_at TIMESTAMPTZ,
    event_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (town_id, source_id)
);
