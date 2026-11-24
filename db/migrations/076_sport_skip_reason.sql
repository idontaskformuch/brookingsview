-- Why a sports source was last skipped (owner 2026-11-24): robots.txt unreadable or refused, with the status code, and when. Kept in its own
-- columns so a later successful run does not overwrite it (last_error is cleared by a clean success). Shown in the freshness alert text.
ALTER TABLE sport_sources_health ADD COLUMN IF NOT EXISTS last_skip_reason TEXT;
ALTER TABLE sport_sources_health ADD COLUMN IF NOT EXISTS last_skip_at     TIMESTAMPTZ;
