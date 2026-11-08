-- Local sports: two flags on sport_events. Additive; existing rows (none yet) get false.
-- time_tba:     the source gives no time; start_at is local midnight of the known day and must never be shown as a clock time.
-- neutral_site: neither side is at home; home/away only orders the two sides and the score.
-- Apply: python -m scripts.apply_migration 067_sport_events_flags --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup first)
ALTER TABLE sport_events ADD COLUMN IF NOT EXISTS time_tba boolean NOT NULL DEFAULT false;
ALTER TABLE sport_events ADD COLUMN IF NOT EXISTS neutral_site boolean NOT NULL DEFAULT false;
