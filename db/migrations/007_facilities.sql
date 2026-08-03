-- 007_facilities.sql
--
-- "Grundläggande faktainfo" om lokala kommunala anläggningar (bibliotek,
-- parker, city hall, m.fl.): adress, telefon, öppettider, en kort
-- beskrivning. Byggd efter samma dedup-mönster som meetings/property_sales
-- (content_hash + UNIQUE(town_id, content_hash)), men datat kommer INTE
-- från en scraper -- det är handkurerat från respektive stads officiella
-- webbplats (moval.org / cityofbrookings-sd.gov), eftersom den här sortens
-- fakta ändras sällan (öppettider några gånger om året i bästa fall) och
-- inte finns i ett maskinläsbart flöde. Se scripts/seed_facilities.py och
-- data/facilities/<town_id>.json -- samma "människan lägger in filen"-mönster
-- som property_sales local_dir, fast som en handskriven JSON istället för en
-- nedladdad kvartalsrapport.
--
-- Bakgrund (session 2026-08-03): Search Console visade att nästan alla
-- exponeringar för Moreno Valley kom från sökningar som "moreno valley
-- library", "lasselle sports park", "mv library" -- ren navigations-/
-- faktaefterfrågan på specifika anläggningar, med 0 klick genomgående
-- eftersom ingen sida faktiskt besvarade frågan. Den här tabellen + sidorna
-- i site/src/pages/facilities/ är avsedda att fylla det gapet.
--
-- slug: används i /facilities/<slug>/, unikt per stad (inte globalt), t.ex.
--       "main-library", "lasselle-sports-park".
-- category: 'library' | 'park' | 'city_hall' | 'community_center' | 'other'
--           (fri text i DB, men sidorna grupperar bara på dessa värden).
-- hours_text: fritext, inte strukturerad öppettids-per-veckodag -- källorna
--             själva är inkonsekventa (helgdagstimmar, säsongsvariation), och
--             fritext är ärligare än att låtsas ha en maskinläst källa.
-- verified_date: när uppgifterna senast stämdes av mot källan. Sidan visar
--             detta öppet istället för att låtsas vara realtidsdata.

BEGIN;

CREATE TABLE IF NOT EXISTS facilities (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    slug           TEXT NOT NULL,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL,
    address        TEXT,
    phone          TEXT,
    website        TEXT,
    hours_text     TEXT,
    description    TEXT,
    lat            DOUBLE PRECISION,
    lon            DOUBLE PRECISION,
    source_url     TEXT,
    verified_date  DATE,
    raw_data       JSONB,
    content_hash   TEXT NOT NULL,
    snapshot_id    BIGINT REFERENCES source_snapshots(id),
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, slug),
    UNIQUE (town_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_facilities_town_category ON facilities (town_id, category, name);

COMMIT;
