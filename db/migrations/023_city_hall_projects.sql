-- City Hall Project Pages (see NEEDS-HUMAN-REVIEW.md, "Week 3 -- City Hall
-- Project Pages"). A project is a hand-curated entity (same pattern as
-- `facilities`/venue_registry.py -- a small, human-verified registry, NOT
-- an auto-detected one) that accumulates a real, sourced timeline as
-- meetings touch it. `project_updates` never carries an invented outcome:
-- `outcome` is 'pending' whenever the meeting body doesn't post an
-- official action/outcome record (verified true today for Planning
-- Commission on Moreno Valley's eSCRIBE portal -- see the same doc) or the
-- source document hasn't been posted yet, never a guess from the agenda
-- alone.

BEGIN;

CREATE TABLE IF NOT EXISTS projects (
    id              BIGSERIAL PRIMARY KEY,
    town_id         TEXT NOT NULL REFERENCES towns(town_id),
    slug            TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    -- 'under_review' | 'approved' | 'permitted' | 'under_construction' |
    -- 'complete' | 'denied' -- see lib/db.ts PROJECT_STATUS_LABELS. Set by
    -- the ingest script from the most recent real update's outcome, never
    -- hand-set independent of a sourced timeline entry.
    status          TEXT NOT NULL DEFAULT 'under_review',
    location_text   TEXT,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    -- The reliable match keys (see ai_pipeline/project_registry.py):
    -- application/case numbers as they appear in agenda item titles
    -- (e.g. "PEN25-0098"). Matching is deliberately case-number-only in
    -- this first pass, never fuzzy title/keyword matching -- a case number
    -- is specific enough to match safely; a keyword is not.
    case_numbers    TEXT[] NOT NULL DEFAULT '{}',
    -- Optional cross-link to the home-sales ZIP digest ("what's being
    -- built near where homes sell") -- a real ZIP the project's address
    -- falls in, never guessed from the town's general area.
    home_sales_zip  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_town_status ON projects (town_id, status);

CREATE TABLE IF NOT EXISTS project_updates (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES projects(id),
    meeting_id      BIGINT REFERENCES meetings(id),
    body            TEXT NOT NULL,      -- "Planning Commission", "City Council Regular Meeting"
    meeting_date    TIMESTAMPTZ NOT NULL,
    agenda_counter  TEXT,               -- e.g. "I.1" -- the eSCRIBE agenda item counter
    agenda_title    TEXT NOT NULL,
    agenda_url      TEXT,
    -- 'Approved' | 'Denied' | 'Continued' | 'Tabled' | 'pending' --
    -- 'pending' means genuinely unknown (no official outcome document
    -- exists yet for this body/meeting), not "presumably approved."
    outcome         TEXT NOT NULL DEFAULT 'pending',
    -- Set only alongside a real outcome pulled from an Action Summary
    -- record -- never populated for a 'pending' row.
    vote_yes        INT,
    vote_no         INT,
    vote_abstain    INT,
    vote_absent     INT,
    source_url      TEXT,               -- the Action Summary / PostMinutes document this outcome came from
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, meeting_id, agenda_counter)
);
CREATE INDEX IF NOT EXISTS idx_project_updates_project ON project_updates (project_id, meeting_date);

-- Flag-for-review, not auto-guess -- same pattern as venue_review_queue
-- (db/migrations/020_event_venue_resolution.sql). Populated when an agenda
-- item's text matches more than one project's case numbers, or matches one
-- ambiguously (see ai_pipeline/project_registry.py).
CREATE TABLE IF NOT EXISTS project_match_review_queue (
    id              BIGSERIAL PRIMARY KEY,
    town_id         TEXT NOT NULL REFERENCES towns(town_id),
    meeting_id      BIGINT REFERENCES meetings(id),
    agenda_counter  TEXT,
    agenda_title    TEXT,
    reason          TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

COMMIT;
