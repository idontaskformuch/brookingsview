-- 005_recipe_ingredients.sql
--
-- Lägger till `ingredients` på `stories`: en strukturerad ingredienslista för
-- vardagsmiddag-recept, separat från `body` (som numera bara innehåller
-- inledning + numrerade instruktioner -- se content/recept/vardagsmiddag.py).
--
-- Samma "ett bord, inte ett nytt"-princip som 004: NULL för allt utom
-- vardagsmiddag, ingen ny parallell tabell eller väg.
--
-- ingredients  TEXT[], en rad per ingrediens (t.ex. "400 g kycklinglår, i
--              bitar"), NULL för allt innehåll som inte är recept.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/005_recipe_ingredients.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS ingredients TEXT[];

COMMIT;
