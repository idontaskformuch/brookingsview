-- Document-fetch failures inside a run (escribe_v1's agenda/minutes/action-
-- summary PDFs, legistar_v1's eventitems) were swallowed into a print(),
-- never reaching scrape_runs -- a run that fetched 0 of N documents still
-- logged status='ok'. Real-world instance: Moreno Valley's action-summary/
-- minutes fetches have hit Cloudflare's "verifying your browser" challenge
-- on filestream.ashx for 7+ weeks (see .claude/state.md, round 5 point 3)
-- with every city_meetings run still showing "ok" daily.
--
-- Additive only (three nullable/defaulted columns) -- no backfill: past
-- rows predate per-document tracking and have nothing real to fill in.

BEGIN;

ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS docs_attempted INT DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS docs_failed INT DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS docs_last_error TEXT;

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/053_scrape_runs_doc_errors.sql
