-- 003_story_content_hash.sql
--
-- Lägger till `content_hash` på stories: en hash av det UNDERLAG en story
-- byggdes av.
--
-- Varför: veckosammanfattningen (ai_pipeline/weekly.py) täcker en hel vecka och
-- måste kunna uppdateras när nya evenemang dyker upp mitt i veckan. Utan ett
-- sätt att se om underlaget ändrats finns bara två dåliga alternativ -- generera
-- om varje timme (slöseri med AI-budget) eller aldrig (sammanfattningen blir
-- inaktuell så fort biblioteket lägger till något på onsdagen).
--
-- Med hashen genereras den om exakt när innehållet ändrats, annars inte alls.
--
-- Kolumnen är generell och kan användas av vilken storytyp som helst framöver.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/003_story_content_hash.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS content_hash TEXT;

COMMIT;
