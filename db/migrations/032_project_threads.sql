-- Story Threads (see Claude Code handoff "Story Threads") -- implemented as
-- an EXTENSION of the existing City Hall Project Pages system
-- (023_city_hall_projects.sql), not a parallel table pair. Investigation
-- before writing this found `projects`/`project_updates` already do almost
-- exactly what "Story Threads" describes for meetings: a hand-curated
-- entity accumulating a real, sourced timeline, matched by exact case
-- number (see ai_pipeline/project_registry.py). What's genuinely new here:
-- traffic as a second source type, a rolling AI-generated summary, a
-- resolved/stalled read on activity, and a review queue for BRAND NEW
-- candidate projects (as opposed to project_match_review_queue, which is
-- for an item that matched more than one EXISTING project ambiguously --
-- a different problem).

BEGIN;

-- The rolling "where things stand" summary is a NEW column, not a reuse of
-- `description` -- `description` is a static, hand-written blurb (only
-- ever changed by a human re-running scripts/seed_projects.py), never
-- touched by the automated pipeline. Confirmed live: no code path updates
-- `projects.description` except that seed script.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rolling_summary TEXT;

-- Deliberately NOT a stored active/stalled/resolved enum. "Stalled" is a
-- function of time (no activity within the quiet-period window) and must
-- be computed fresh at read time from `updated_at` -- baking it into a
-- column risks the exact staleness bug the home-sales age-out work
-- (2026-08-28) was built to avoid: a flag set once and never revisited as
-- time passes. `resolved`, by contrast, genuinely needs a stored fact --
-- nothing about elapsed time can tell you a project concluded -- so it's
-- the one real piece of state here. NULL = still open (active or stalled,
-- computed from updated_at); non-null = resolved on that date.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- project_updates gets a second source type. All meeting-specific columns
-- (meeting_id, agenda_counter, agenda_title, agenda_url, outcome, vote_*)
-- stay exactly as they are and simply go unused/NULL for a traffic-sourced
-- row -- this is additive, not a redesign of the meeting path.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'meeting';
ALTER TABLE project_updates ALTER COLUMN meeting_id DROP NOT NULL;
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS traffic_incident_id BIGINT REFERENCES traffic_incidents(id);
-- The short, source-grounded "what changed" line -- distinct from
-- agenda_title (the source's own item title) and outcome (a structured
-- vote result). Nullable: older meeting-sourced rows predate this and are
-- not backfilled retroactively.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS synthesis TEXT;
-- agenda_title/meeting_date/body were NOT NULL for the meetings-only
-- design; a traffic-sourced row has none of those in the same shape, so
-- they're relaxed to nullable here rather than populated with placeholder
-- text a traffic entry has no real value for.
ALTER TABLE project_updates ALTER COLUMN body DROP NOT NULL;
ALTER TABLE project_updates ALTER COLUMN meeting_date DROP NOT NULL;
ALTER TABLE project_updates ALTER COLUMN agenda_title DROP NOT NULL;
-- entry_date is the source_type-agnostic date every row needs (meeting_date
-- for a meeting row, the traffic incident's own relevant date for a
-- traffic row) -- added rather than overloading meeting_date's name for a
-- non-meeting row.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS entry_date TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_project_updates_source_type ON project_updates (source_type);

-- Candidate NEW projects (no existing project matched at all -- distinct
-- from project_match_review_queue, which is for an item matching MORE
-- THAN ONE existing project ambiguously). Never auto-created into a real
-- `projects` row -- see scripts/review_project_candidates.py, which
-- mirrors scripts/review_comments.py's exact human-in-the-loop pattern.
CREATE TABLE IF NOT EXISTS project_new_candidate_queue (
    id                   BIGSERIAL PRIMARY KEY,
    town_id              TEXT NOT NULL REFERENCES towns(town_id),
    source_type          TEXT NOT NULL,       -- 'meeting' | 'traffic'
    meeting_id           BIGINT REFERENCES meetings(id),
    traffic_incident_id  BIGINT REFERENCES traffic_incidents(id),
    -- The extracted candidate identity (street/parcel/project name) and
    -- the AI's own stated reasoning for why this looks thread-worthy --
    -- a human reviewing the queue sees the citation, not a bare flag.
    candidate_title      TEXT NOT NULL,
    candidate_summary    TEXT NOT NULL,
    match_reasoning      TEXT NOT NULL,
    confidence           DOUBLE PRECISION NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending_review',  -- 'pending_review' | 'approved' | 'rejected'
    created_at           TIMESTAMPTZ DEFAULT now(),
    reviewed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_project_new_candidate_queue_status ON project_new_candidate_queue (town_id, status);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/032_project_threads.sql
