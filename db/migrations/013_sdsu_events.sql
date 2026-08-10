-- 013_sdsu_events.sql
--
-- SDSU-evenemang (event-calendar på sdstate.edu) för Brookings -- se
-- scrapers/parsers/sdsu_events_v1.py. Ett ANNAT bord än `events` (stadens
-- allmänna evenemangskälla) eftersom SDSU-kalendern har egen kategori-
-- taggning (categories) som /university.astro grupperar på, och ett eget
-- filtreringssteg (bara Athletics/Music/Special Events/Theatre-Dance/
-- Camps-Conferences skrapas -- interna/administrativa kategorier som
-- Meetings/Academic/Admissions/Career-Job Fairs/Workshops-Training hoppas
-- över redan i fetch(), se parserns CATEGORY_WHITELIST).
--
-- external_event_id  URL-sökvägen (t.ex. "/events/2026/08/home-soccer") --
--                     stabil per instans, verifierad live 2026-08-10 (ingen
--                     upprepad-instans-querysträng påträffad).
-- categories          ALLA kategoritaggar eventet har (ett event kan ha
--                      fler än en, t.ex. både "Health/Wellness" och
--                      "Special Events") -- primary_category är den FÖRSTA
--                      som matchar CATEGORY_WHITELIST, används för
--                      ikon/grupp i frontend utan att räkna om det vid
--                      varje sidladdning.
-- teaser               KORT sammanfattning, redan avkortad av källan själv
--                       (kalenderlistan visar bara en teaser, aldrig hela
--                       eventbeskrivningen) -- se parserns moduldocstring
--                       för upphovsrättsresonemanget.
--
-- DEDUP/UPPDATERING: ett SDSU-evenemang kan legitimt uppdateras (ändrad tid,
-- inställt pga väder, ny lokal) för SAMMA post -- samma "mutable record"-
-- resonemang som regional_sports_games/traffic_incidents, till skillnad
-- från t.ex. jobs (append-only). conflict_columns/update_columns styr
-- db.upsert_records() mot ON CONFLICT (town_id, external_event_id) DO
-- UPDATE.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/013_sdsu_events.sql

BEGIN;

CREATE TABLE IF NOT EXISTS sdsu_events (
    id                BIGSERIAL PRIMARY KEY,
    town_id           TEXT NOT NULL REFERENCES towns(town_id),
    external_event_id TEXT NOT NULL,
    title             TEXT NOT NULL,
    teaser            TEXT,
    location          TEXT,
    starts_at         TIMESTAMPTZ,
    ends_at           TIMESTAMPTZ,
    categories        TEXT[] NOT NULL DEFAULT '{}',
    primary_category  TEXT,
    event_url         TEXT NOT NULL,
    source            TEXT NOT NULL DEFAULT 'sdsu_event_calendar',
    raw_data          JSONB,
    content_hash      TEXT NOT NULL,
    snapshot_id       BIGINT REFERENCES source_snapshots(id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_sdsu_events_town_starts ON sdsu_events (town_id, starts_at);

COMMIT;
