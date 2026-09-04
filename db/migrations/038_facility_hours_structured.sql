-- Recurring-traffic layer handoff, Phase 2: structured per-weekday facility
-- hours, for computing "open now" -- see ai_pipeline/facility_hours.py (the
-- deterministic parser that backfills this from the existing hours_text)
-- and site/src/lib/facility-hours.ts (the pure "is it open right now"
-- function the site actually renders from).
--
-- hours_text is left completely untouched -- it stays the fallback display
-- for any row that isn't (yet, or can't be) confidently parsed into
-- structure, per the "flag ambiguous rather than guess" rule. Three real
-- states, distinguished explicitly rather than inferred from NULL alone
-- (same shape as the existing image_needs_review boolean on this table):
--   hours_text NULL,                              hours_structured NULL,     needs_review=false -> genuinely no data
--   hours_text set, parser could not confidently read it,  hours_structured NULL,     needs_review=true  -> flagged for a human
--   hours_text set, parser succeeded,              hours_structured set,      needs_review=false -> usable
--
-- hours_structured shape: {"monday": {"open":"09:00","close":"21:00"} | null, ...
-- all 7 weekday keys always present, one row = one facility's whole week,
-- 24h local "HH:MM" strings, null value = closed that day. A single JSONB
-- column (not 7 separate columns, not a child table) because the unit that
-- actually gets read and written is always "this facility's whole week at
-- once," never a single day in isolation -- same "bounded structured
-- sub-document" shape as weather_snapshots.payload/meetings.raw_data
-- elsewhere in this schema.

BEGIN;

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS hours_structured JSONB;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS hours_needs_review BOOLEAN NOT NULL DEFAULT false;

COMMIT;
