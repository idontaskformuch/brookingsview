-- 015_sdsu_events_bucket.sql
--
-- Editorial-omorganisering (Fix Round 1, se scrapers/parsers/sdsu_events_v1.py):
-- de fem skrapade kategorierna (Athletics/Music/Special Events/Theatre-Dance/
-- Camps-Conferences) delas nu på TVÅ sidor i stället för att alla fem visas
-- på /university:
--   bucket='university'    Athletics + Camps/Conferences -> /university
--   bucket='arts_culture'  Music + Special Events + Theatre/Dance -> /events
--                          (taggade "Arts & Culture", samma kortkomponent
--                          som stadens övriga events, se StoryCard.astro)
-- Museum-/trädgårdsvenue (South Dakota Art Museum, McCrory Gardens) tvingas
-- till arts_culture via platsnamn oavsett kategori-ID, se BUCKET_MAP/
-- _ARTS_VENUE_KEYWORDS i parsern -- skydd för events utan en ren egen
-- kategori-ID.
--
-- is_filtered/filter_reason  deterministisk (ingen AI) bortfiltrering av
-- internt/icke-publikt brus (invite-only-notiser, personalpensions-
-- mottagningar) -- FLAGGAS, tas inte bort, så filtreringen kan justeras
-- senare utan att skrapa om. Samma "flagga, kasta inte"-princip som
-- is_closure i school_alerts_v1.py.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/015_sdsu_events_bucket.sql

BEGIN;

ALTER TABLE sdsu_events
  ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT 'university',
  ADD COLUMN IF NOT EXISTS is_filtered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filter_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sdsu_events_bucket ON sdsu_events (town_id, bucket, starts_at);

COMMIT;
