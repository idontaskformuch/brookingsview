-- Handoff: Information Hub Tier 1, Feature B (New in Town).
--
-- local_businesses: one row per (town, business name, status) claim that
-- survived the pipeline's guardrails (see ai_pipeline/new_in_town_digest.py).
-- A 'closed' row only ever exists here once the two-source rule is
-- satisfied -- see local_business_sources below and needs_review.
--
-- local_business_sources: every source that corroborated a given claim,
-- beyond the first (already recorded on local_businesses itself via
-- source_url/source_name). Lets a 'closed' claim's needs_review flag move
-- from true to false the moment a second independent source confirms it,
-- without losing the first source's citation.
--
-- search_request_log: hard, DB-backed request ceiling for paid search APIs
-- (Brave Search, currently the only one) -- see ai_pipeline/search_budget.py.
-- Not a local JSON file (the pattern ai_pipeline/format_prompt.py's AI spend
-- tracker uses): a GitHub Actions runner starts from a fresh checkout every
-- run, so a local file always reads back as "zero spent so far," making a
-- cross-run monthly ceiling a no-op in practice -- exactly the class of bug
-- ("existed in config, never actually checked in code") that refresh_minutes
-- was for a long time before db.py's last_run_at fix. This table is the one
-- store durable across runs AND shared across every town's separate
-- workflow, which the feature's GLOBAL ceiling (across all towns) needs.
--
-- Run once: psql "$DATABASE_URL" -f db/migrations/031_local_businesses.sql

BEGIN;

CREATE TABLE IF NOT EXISTS local_businesses (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    name           TEXT NOT NULL,
    category       TEXT,
    status         TEXT NOT NULL CHECK (status IN ('opened', 'opening_soon', 'closed')),
    address        TEXT,
    source_url     TEXT NOT NULL,
    source_name    TEXT NOT NULL,
    reported_date  DATE,
    first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    needs_review   BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (town_id, name, status)
);

CREATE INDEX IF NOT EXISTS local_businesses_town_seen_idx
    ON local_businesses (town_id, first_seen DESC);

CREATE TABLE IF NOT EXISTS local_business_sources (
    id                 BIGSERIAL PRIMARY KEY,
    local_business_id  BIGINT NOT NULL REFERENCES local_businesses(id) ON DELETE CASCADE,
    source_url         TEXT NOT NULL,
    source_name        TEXT NOT NULL,
    reported_date      DATE,
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (local_business_id, source_url)
);

CREATE TABLE IF NOT EXISTS search_request_log (
    id             BIGSERIAL PRIMARY KEY,
    town_id        TEXT NOT NULL REFERENCES towns(town_id),
    provider       TEXT NOT NULL,
    period         DATE NOT NULL,
    request_count  INT NOT NULL DEFAULT 0,
    UNIQUE (town_id, provider, period)
);

COMMIT;
