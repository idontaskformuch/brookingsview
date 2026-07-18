-- 002_occurs_at.sql
--
-- Lägger till `occurs_at` på stories: NÄR något faktiskt händer, till skillnad
-- från `published_at` som är när vi skrev texten.
--
-- Varför det behövs: utan detta kan frontend inte skilja "den här veckan" från
-- "förra månaden", och kan inte avgöra om en varning fortfarande gäller. Det var
-- den lucka som lät en vägavstängning från 2023 publiceras som aktuell.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/002_occurs_at.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS occurs_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stories_town_occurs
    ON stories (town_id, occurs_at DESC);

-- ---------------------------------------------------------------------------
-- Backfill av befintliga rader. Möjligt eftersom sluggen är deterministisk
-- ("{source_type}-{källradens id}"), så varje story kan kopplas tillbaka till
-- sin ursprungsrad utan gissningar.
-- ---------------------------------------------------------------------------

UPDATE stories s
   SET occurs_at = m.meeting_date
  FROM meetings m
 WHERE s.town_id = m.town_id
   AND s.slug = 'meeting-' || m.id
   AND s.occurs_at IS NULL;

UPDATE stories s
   SET occurs_at = e.starts_at
  FROM events e
 WHERE s.town_id = e.town_id
   AND s.slug IN ('event-' || e.id, 'alert-' || e.id)
   AND s.occurs_at IS NULL;

-- ---------------------------------------------------------------------------
-- Rensa inaktuella varningar som redan hunnit publiceras.
--
-- En varning är en INSTRUKTION ("planera en annan väg"), inte ett arkiv. En
-- inaktuell varning är därför aktivt skadlig, till skillnad från ett passerat
-- evenemang som bara är historik. County:ts Alert Center rensar aldrig gamla
-- poster, så detta måste ske på vår sida.
-- ---------------------------------------------------------------------------

DELETE FROM stories
 WHERE source_type = 'alert'
   AND occurs_at IS NOT NULL
   AND occurs_at < now() - interval '14 days';

COMMIT;
