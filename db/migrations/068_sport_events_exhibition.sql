-- Local sports: exhibition flag on sport_events. Additive; existing rows (none yet) get false.
-- exhibition: the source names the game an exhibition or a scrimmage in so many words. Never inferred from a missing score.
--             Exhibitions are shown but never count towards a record or standings (status='final' AND NOT exhibition).
-- Apply: python -m scripts.apply_migration 068_sport_events_exhibition --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup first)
ALTER TABLE sport_events ADD COLUMN IF NOT EXISTS exhibition boolean NOT NULL DEFAULT false;
