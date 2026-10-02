-- 048_publish_discard_streak.sql
--
-- Caps the indefinite retry loop in ai_pipeline/publish.py: a meeting/event/
-- alert record that fails format_record() both attempts (generated_by ==
-- 'template_fallback', no TEMPLATERS fallback for these types) is discarded
-- WITHOUT being added to known_slugs/known_meeting_ids, so the next
-- scheduled run (every 6h) retries it from scratch -- forever, with no
-- counter, if the record is structurally stuck (see NEEDS-HUMAN-REVIEW.md
-- #77/#78 and api_usage.reject_reason for the investigation that found
-- this). This table tracks consecutive discards per record; after 3,
-- publish.py stops retrying it for good and alerts (ALERT_WEBHOOK) rather
-- than silently re-spending on it every 6 hours indefinitely.
--
-- Only ever holds CURRENTLY struggling records -- a row is deleted the
-- moment that record finally publishes (proves it wasn't permanently
-- stuck), and deleted again once it crosses the give-up threshold (nothing
-- left to track once it's permanently excluded).

BEGIN;

CREATE TABLE IF NOT EXISTS publish_discard_streak (
    town_id             TEXT NOT NULL REFERENCES towns(town_id),
    source_type         TEXT NOT NULL,
    -- str(row["id"]) -- TEXT, not INT: a grouped recurring-event series uses
    -- a synthetic "series-<16-hex-hash>" id (publish.py's
    -- group_recurring_events(), stable across runs by design), not a plain
    -- integer the way a meeting or non-recurring event row does.
    record_id           TEXT NOT NULL,
    consecutive_runs    INT NOT NULL DEFAULT 1,
    first_discarded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_discarded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_reject_reason  TEXT,
    PRIMARY KEY (town_id, source_type, record_id)
);

COMMIT;
