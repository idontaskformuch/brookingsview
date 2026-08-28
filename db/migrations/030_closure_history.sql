-- Handoff: Information Hub Tier 1, Feature A (Closure Watch).
--
-- closure_history: one row per CONFIRMED school closure (from the existing
-- school_alerts table, is_closure=true), recording which NWS alert_event (if
-- any, from the existing events/nws_alert rows) was active in the ~24h
-- before it. Lets the Watch state answer "has this kind of alert actually
-- led to a closure here before?" instead of guessing. Starts empty, accrues
-- via ai_pipeline/closure_watch_digest.py -- no backfill, see that module's
-- docstring. A town/alert_event with zero rows here just means the Watch
-- state's historical-context line is omitted, never fabricated.
--
-- closure_watch_prose: the optional AI-generated Watch-state paragraph, one
-- row per (town_id, alert). Existence of a row means the guardrailed AI
-- draft passed; ABSENCE means the page renders its static fallback --
-- deliberately no "generated_by='template_fallback'" row written here (see
-- closure_watch_digest.py), so "no row yet" and "guardrail rejected it" are
-- the same, safe code path on the read side.
--
-- Run once: psql "$DATABASE_URL" -f db/migrations/030_closure_history.sql

BEGIN;

CREATE TABLE IF NOT EXISTS closure_history (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    district      TEXT NOT NULL,
    closure_date  DATE NOT NULL,
    alert_event   TEXT,
    source_url    TEXT NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, district, closure_date)
);

CREATE INDEX IF NOT EXISTS closure_history_town_date_idx
    ON closure_history (town_id, closure_date DESC);

CREATE TABLE IF NOT EXISTS closure_watch_prose (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    alert_url     TEXT NOT NULL,
    body          TEXT NOT NULL,
    generated_by  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, alert_url)
);

COMMIT;
