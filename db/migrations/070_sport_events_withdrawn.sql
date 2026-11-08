-- Local sports: stale-event handling. Additive; existing rows get withdrawn_at NULL and missed_runs 0.
-- withdrawn_at: set by sports/runner.py (sports/withdraw.py) when an UPCOMING game its source listed is gone from the source after two
--               successful runs in a row (or at once when it was moved: a new row for the same opponent and side took its place).
--               Readers hide a row where it is set; the upsert clears it if the source lists the game again. Nothing is deleted.
-- missed_runs:  how many successful runs in a row did not list the row; the upsert resets it to 0.
-- Apply: python -m scripts.apply_migration 070_sport_events_withdrawn --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup first, the owner's own yes: CLAUDE.md rule 14)
ALTER TABLE sport_events ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE sport_events ADD COLUMN IF NOT EXISTS missed_runs integer NOT NULL DEFAULT 0;
