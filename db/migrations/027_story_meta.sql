-- 027_story_meta.sql
--
-- Summary Tone Prompts (see NEEDS-HUMAN-REVIEW.md): meeting/event/alert
-- generation moves from a single prose blob to {summary, meta} JSON (see
-- ai_pipeline/format_prompt.py's build_system_prompt_v2()/parse_tone_v2()) so
-- reference data (address, phone, time, recurrence, audience, cost,
-- registration) can be rendered as a compact metadata row instead of
-- occupying the first sentence of the prose.
--
-- NULL for every row published before this shipped (forward-only, no
-- retroactive backfill -- same convention as image_alt, 025_image_alt.sql)
-- and for every content-track story (editorial/culture_essay/...), which
-- this feature never touches. Callers render nothing when meta is NULL or
-- a given key is absent -- never a fabricated/empty metadata row.
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/027_story_meta.sql

BEGIN;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS meta JSONB;

COMMIT;
