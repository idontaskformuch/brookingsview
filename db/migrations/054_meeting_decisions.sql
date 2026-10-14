-- Phase 7, "Decisions" (Brookings/Legistar first -- see .claude/spec-phases-3-9.md).
-- An agenda says what will be considered, not what was decided -- outcomes
-- come only from Legistar's own official action fields (EventItemPassedFlagName,
-- EventItemMatterStatus), never from the agenda text or a staff recommendation.
--
-- One row per Legistar EventItem that carries a real Matter (case number) --
-- pure procedural rows (call to order, roll call, adjourn, section headers)
-- are never ingested here; see ai_pipeline/meeting_decisions_legistar.py.
-- event_item_id is a real, globally unique Legistar ID -- used as the
-- natural key directly (no NULL-based ON CONFLICT pitfall, unlike
-- project_updates' meeting_id/agenda_counter pair -- see that table's own
-- upsert_project_update() docstring for the bug this avoids).

BEGIN;

CREATE TABLE IF NOT EXISTS meeting_decisions (
    id                          BIGSERIAL PRIMARY KEY,
    meeting_id                  BIGINT REFERENCES meetings(id),
    event_item_id               BIGINT NOT NULL UNIQUE,
    agenda_number               TEXT,
    title                       TEXT NOT NULL,
    matter_id                   BIGINT,
    matter_file                 TEXT,
    matter_type                 TEXT,
    -- Verbatim source fields, kept for transparency/debugging -- never
    -- the basis for `outcome` on their own (EventItemActionName is known
    -- to sometimes be mislabeled at the source; see the ingest script's
    -- outcome_from_item() for the verified real example that forced this).
    action_name                 TEXT,
    action_text                 TEXT,
    passed_flag                 TEXT,          -- 'Pass' | 'Fail' | NULL (EventItemPassedFlagName, verbatim)
    matter_status                TEXT,          -- EventItemMatterStatus, verbatim
    -- Normalized outcome. 'pending' = no official result posted yet --
    -- this is the "On the agenda" state; any other value is "Decided".
    outcome                     TEXT NOT NULL DEFAULT 'pending'
        CHECK (outcome IN ('approved', 'denied', 'continued', 'adopted',
                            'received_and_filed', 'tabled', 'other', 'pending')),
    -- EventItemConsent (verbatim boolean). Consent items' real roll-call
    -- vote lives under a single shared block item, not on each item
    -- individually -- see consent_block_event_item_id.
    is_consent_item              BOOLEAN NOT NULL DEFAULT false,
    -- Set only when this item's own /votes response resolves to a
    -- DIFFERENT EventItemId (the shared consent-agenda block vote,
    -- confirmed live: VoteEventItemId on every returned vote row, not
    -- guessed). NULL for a non-consent item or the block item itself.
    consent_block_event_item_id  BIGINT,
    -- Per-member roll call: [{"person": "Bonny Specker", "value": "Yes"}, ...].
    -- NULL when Legistar has no roll call recorded for this item (common
    -- for a voice-vote/unanimous-consent action with no individual tally,
    -- or an item with no vote at all, e.g. "presented"/"read into the record").
    votes                        JSONB,
    source_url                   TEXT,
    created_at                   TIMESTAMPTZ DEFAULT now(),
    updated_at                   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_meeting ON meeting_decisions (meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_matter ON meeting_decisions (matter_id);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/054_meeting_decisions.sql
