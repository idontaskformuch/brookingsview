-- A real official outcome the automated pipeline can never see (no
-- Action Summary / Legistar history record exists for it) but a human has
-- verified against a real, linked source document -- e.g. a Planning
-- Commission "Minute Order" PDF found outside eSCRIBE (see .claude/
-- state.md's "Planning Commission minutes research", 2026-10-13: PEN24-0154
-- was denied 2-3, a real certified fact with no path into outcome/vote_*
-- today).
--
-- Deliberately NOT written to outcome/vote_yes/vote_no themselves: those
-- are recomputed from THIS row's own meeting's action_summary_items on
-- every pipeline rerun (ai_pipeline/project_updates.py's
-- upsert_project_update(), EXCLUDED.outcome unconditionally), so a
-- hand-typed value there would silently be overwritten back to 'pending'
-- the next time the real pipeline runs over this meeting -- durable,
-- non-destructive to the automated pipeline's own view, not blended into
-- the recomputed fields it owns. ai_pipeline/project_updates.py and
-- ai_pipeline/project_updates_legistar.py never reference either column
-- below -- that is the actual guarantee the pipeline "can't overwrite it",
-- not a runtime check.

BEGIN;

ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS outcome_override TEXT;
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS outcome_override_source_url TEXT;

-- Both or neither -- an override with no citation is exactly the kind of
-- unsourced claim this whole codebase's guardrail discipline exists to
-- prevent; a bare source_url with no text is meaningless.
ALTER TABLE project_updates ADD CONSTRAINT project_updates_outcome_override_needs_source
    CHECK ((outcome_override IS NULL) = (outcome_override_source_url IS NULL));

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/052_project_update_outcome_override.sql
