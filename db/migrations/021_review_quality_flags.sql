-- 021_review_quality_flags.sql
--
-- Flag-for-review queue for content/recensioner/review_standard.py's
-- structural checks against the Review Writing Standard (see
-- NEEDS-HUMAN-REVIEW.md "Review Writing Standard"). Same shape and
-- philosophy as venue_review_queue (020_event_venue_resolution.sql): the
-- story is NOT held back -- it publishes -- this table only records that a
-- human should take a look. These are among the site's highest-effort
-- pieces; a false positive on a heuristic regex check shouldn't cost a good
-- review its publication.

BEGIN;

CREATE TABLE IF NOT EXISTS review_quality_flags (
    id           BIGSERIAL PRIMARY KEY,
    town_id      TEXT NOT NULL REFERENCES towns(town_id),
    story_slug   TEXT NOT NULL,
    reasons      TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- set true by a human once looked at (fixed by hand, judged a false
    -- positive, or otherwise dealt with) -- excluded from the "what needs
    -- attention" view either way, same convention as
    -- venue_review_queue.resolved.
    resolved     BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (town_id, story_slug)
);
CREATE INDEX IF NOT EXISTS idx_review_quality_flags_open
    ON review_quality_flags (town_id, created_at DESC) WHERE NOT resolved;

COMMIT;
