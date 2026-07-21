-- 004_content_track_columns.sql
--
-- Lägger till tre kolumner på `stories` för Innehållsspår v1 (krönikor/recensioner/
-- recept): byline, image_path, rating. `source_type` finns redan (nullable TEXT,
-- schema.sql rad 169) och behöver ingen ändring -- nya värden ("kultur_essa",
-- "ledare", ...) skrivs bara in, samma kolumn som meeting/event/alert/weekly.
--
-- Ett bord, inte ett nytt: befintlig feed-/storysides-rendering behöver ingen
-- parallell väg för "genererat" vs "skrapat" innehåll, bara ett villkor som visar
-- byline/bild/betyg när de finns (NULL för allt skrapat nyhetsinnehåll).
--
-- byline      "AI-genererad" -- renderas i Byline.astro, NULL för scraped stories.
-- image_path  sökväg till Steg 3.5:s illustration, NULL tills den kopplas på.
-- rating      endast media_recension (t.ex. 4.5 av 5), NULL för allt annat.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/004_content_track_columns.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS byline TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1);

COMMIT;
