-- Evening register: link to places, "1st & 3rd Monday" rules and an end date (owner 2026-11-13, option B in
-- .claude/notes/broomfield-event-sources.md: extend the register instead of a second store for recurring nights).
-- Columns only, no existing row changed: every current entry keeps weeks_of_month = '{}' (every week) and valid_until NULL.
--
-- place_id:        the places row the venue is (set from configs/<town>.json "place_slug" by scripts/refresh_evening_register.py),
--                  NULL while the venue has no place row. Lets a place page list the venue's regular nights.
-- weeks_of_month:  '{}' = every week; {1,3} = 1st and 3rd; {-1} = last. Validated against the quote ("1st & 3rd Monday").
-- valid_until:     the last date the venue's page gives for a recurring night ("every Monday Nov 1 to Nov 24"); the site drops the
--                  rule after it. NULL = open-ended (freshness still applies: REGISTER_MAX_AGE_DAYS recurring 35).
ALTER TABLE evening_register_venues ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places (id);
ALTER TABLE evening_register_entries ADD COLUMN IF NOT EXISTS weeks_of_month SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE evening_register_entries ADD COLUMN IF NOT EXISTS valid_until DATE;
