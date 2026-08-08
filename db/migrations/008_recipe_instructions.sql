-- 008_recipe_instructions.sql
--
-- Lägger till `instructions` på `stories`: en strukturerad steg-för-steg-lista
-- för vardagsmiddag-recept, separat från `body` (som nu bara innehåller
-- inledningen -- se content/recept/vardagsmiddag.py). Samma mönster som
-- 005_recipe_ingredients.sql, fast för instruktionerna: extraheras via en
-- egen <<<INSTRUCTIONS>>>-markör, samma extract_marked_list()-mekanism
-- (redan generisk över markörpar, ingen ändring behövd där).
--
-- Bakgrund (2026-08-08): en DB-granskning visade att 2 av 4 publicerade
-- vardagsmiddag-recept (50%) hade misslyckad ingrediens-extraktion -- modellen
-- följde inte alltid markörformatet, och hela receptet hamnade som en
-- oformaterad textklump i body i stället för en strukturerad lista. write()
-- i vardagsmiddag.py publicerar nu INTE ett recept vars extraktion misslyckas
-- (för ingredienser ELLER instruktioner) -- hellre inget recept den dagen än
-- ett strukturlöst, samma princip som redan gäller för budgettak/original-
-- litetskontroll i _base.py.generate_article().
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/008_recipe_instructions.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS instructions TEXT[];

COMMIT;
