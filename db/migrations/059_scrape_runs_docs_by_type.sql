-- Refines Migration 053 (docs_attempted/docs_failed/docs_last_error): those
-- three columns are a SINGLE pooled counter across every document type a
-- parser fetches (escribe_v1's agenda+minutes+action_summary all add into
-- the same docs_attempted/docs_failed). That pooling is exactly why the
-- 2026-10-15 id=12561 run logged status='ok' with docs_failed=3/15 -- 3/3
-- action-summary fetches failed (the Cloudflare-blocked type) but the other
-- 12 agenda+minutes fetches succeeded, so the pooled total never reached
-- "every attempt failed." A run where the ONE critical type that actually
-- carries decision outcomes (action_summary, see meeting_followups.py) is
-- 100% blocked, while agenda fetches mask it by succeeding, should not read
-- as plain 'ok'.
--
-- docs_by_type carries the per-type breakdown runner.py needs to detect
-- that case. JSONB, not one rigid column per type, because the type set is
-- parser-specific (escribe_v1: agenda/minutes/action_summary; legistar_v1:
-- eventitems/votes) and a future parser's own types shouldn't need a new
-- migration -- same reasoning as raw_data JSONB elsewhere in this schema.
-- Shape: {"<type>": {"attempted": int, "failed": int}, ...}.
--
-- Additive only (one nullable column) -- no backfill, same as 053: past
-- rows predate per-type tracking and have nothing real to fill in.

BEGIN;

ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS docs_by_type JSONB;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/059_scrape_runs_docs_by_type.sql
