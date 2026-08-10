-- 009_regional_sports.sql
--
-- Regionala/pro-lag-matcher (Angels, Ducks, Dodgers, Lakers, Clippers, Rams,
-- Chargers, Inland Empire 66ers m.fl.) för städer utan ett eget lokalt lag
-- att bevaka -- ett ANNAT bord än det redan existerande `sports_games`
-- (används av SDSU Jackrabbits/Brookings, se db/schema.sql). MEDVETET separat:
-- `sports_games` har en helt annan form (ett lag, sport-kolumn för
-- disciplin, content_hash-dedup eftersom en spelad match är oföränderlig
-- källdata) och en existerande konsument (site/src/lib/db.ts:getSeasonGames/
-- getUpcomingGames, site/src/pages/jackrabbits.astro). Att återanvända
-- samma tabellnamn med en annan kolumnform hade antingen krävt en invasiv
-- migration av en redan fungerande funktion, eller (om CREATE TABLE IF NOT
-- EXISTS bara tyst hoppat över eftersom tabellen redan finns) fått varje
-- INSERT att krascha på kolumner som inte existerar. Nytt namn, ingen risk.
--
-- Skiljer sig även i DEDUP-STRATEGI från de flesta andra tabellerna: en
-- matchs status/resultat ÄNDRAS legitimt över tid (scheduled -> live ->
-- final), till skillnad från t.ex. en möteshandling eller en registrerad
-- fastighetsförsäljning som är oföränderlig källdata. content_hash finns
-- kvar som kolumn (revisionsspår), men KONFLIKTMÅLET för upsert är
-- (town_id, external_game_id) -- källans egna, stabila match-id -- med
-- DO UPDATE på statusfälten, inte DO NOTHING. Se db/db.py:upsert_records()
-- (conflict_columns/update_columns-parametrarna, tillagda för just detta).
--
-- external_game_id  matchens egna id hos källan (ESPN-event-id eller MLB
--                    Stats API:s gamePk) -- unikt per (town_id, källa).
-- relevance_tier     'primary' | 'secondary' -- primary = närmast/mest
--                    lokalt relevant (t.ex. Inland Empire 66ers för Moreno
--                    Valley), secondary = bredare marknadsrelevans (LA-lagen
--                    i stort). Styr sorteringen på /sports, inte en filter.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/009_regional_sports.sql

BEGIN;

CREATE TABLE IF NOT EXISTS regional_sports_games (
    id               BIGSERIAL PRIMARY KEY,
    town_id          TEXT NOT NULL REFERENCES towns(town_id),
    league           TEXT NOT NULL,          -- 'mlb' | 'nhl' | 'nba' | 'nfl' | 'milb'
    team_name        TEXT NOT NULL,
    team_abbr        TEXT,
    opponent_name    TEXT NOT NULL,
    home_away        TEXT,                   -- 'home' | 'away'
    game_date        DATE,
    game_time_utc    TIMESTAMPTZ,
    status           TEXT,                   -- 'scheduled' | 'live' | 'final' | 'postponed'
    team_score       INTEGER,
    opponent_score   INTEGER,
    venue            TEXT,
    relevance_tier   TEXT NOT NULL DEFAULT 'secondary',
    source           TEXT NOT NULL,          -- 'espn' | 'mlb_statsapi'
    external_game_id TEXT NOT NULL,
    raw_data         JSONB,
    content_hash     TEXT NOT NULL,
    snapshot_id      BIGINT REFERENCES source_snapshots(id),
    created_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, external_game_id)
);
CREATE INDEX IF NOT EXISTS idx_regional_sports_town_date ON regional_sports_games (town_id, game_date);

COMMIT;
