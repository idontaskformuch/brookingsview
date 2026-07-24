-- 005_content_track_ingredients.sql
--
-- Lägger till `ingredients` på `stories` för vardagsmiddag (recept):
-- ingredienslistan bryts nu ut som en egen strukturerad lista i stället för
-- att stå som löptext i body (se content/_base.py:extract_marked_list()
-- och content/recept/vardagsmiddag.py). TEXT[] eftersom det är en enkel lista
-- av rader ("400 g kycklinglår, i bitar"), ingen egen struktur per rad.
--
-- NULL för allt annat innehåll (möten/event/varningar/krönikor/recensioner) --
-- inget att bryta ut, ingen ändring för dem.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/005_content_track_ingredients.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS ingredients TEXT[];

COMMIT;
