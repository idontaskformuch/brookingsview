-- Election phase 2 (spec: .claude/specs/election-2026.md, 2b): results snapshots.
-- NOT yet applied to the live database -- needs the owner's approval first
-- (CLAUDE.md rule 7). Purely additive: four new tables, nothing existing is touched.
--
-- Shape: a snapshot is one fetch of one source for one town. Raw data is kept in
-- full and old snapshots are never deleted. A snapshot that fails validation
-- (election-results/src/validate.ts) is stored with valid = FALSE and never shown;
-- the page keeps rendering the last valid snapshot with its own timestamp.
-- No AI is involved anywhere in these tables (hard rule 1).

BEGIN;

CREATE TABLE IF NOT EXISTS election_contests (
    id                BIGSERIAL PRIMARY KEY,
    town_id           TEXT NOT NULL REFERENCES towns(town_id),
    election_date     DATE NOT NULL,
    -- The source's own contest id (SD: numeric id from the sheet name; Clarity: contest key).
    -- Matching is always on this, never on the name (spec 2c).
    source_contest_id TEXT NOT NULL,
    name              TEXT NOT NULL,
    jurisdiction      TEXT,
    party             TEXT,
    seats             INTEGER,
    ballot_order      INTEGER,
    UNIQUE (town_id, election_date, source_contest_id)
);

CREATE TABLE IF NOT EXISTS election_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    town_id             TEXT NOT NULL REFERENCES towns(town_id),
    election_date       DATE NOT NULL,
    -- Which adapter produced it: 'sd_xlsx' | 'clarity_state' | 'clarity_county'.
    source_kind         TEXT NOT NULL
        CHECK (source_kind IN ('sd_xlsx', 'clarity_state', 'clarity_county')),
    source_url          TEXT NOT NULL,
    -- The source's own "last updated" as printed; NULL when the source gives none.
    source_updated_at   TEXT,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Hash of the raw payload; an unchanged hash means nothing new, no new row needed.
    raw_hash            TEXT NOT NULL,
    raw_payload         BYTEA NOT NULL,
    valid               BOOLEAN NOT NULL DEFAULT FALSE,
    -- Every blocking reason from validateSnapshot(); empty array when valid.
    problems            TEXT[] NOT NULL DEFAULT '{}',
    precincts_reported  INTEGER,
    precincts_total     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_election_snapshots_latest_valid
    ON election_snapshots (town_id, election_date, fetched_at DESC) WHERE valid;
CREATE INDEX IF NOT EXISTS idx_election_snapshots_hash
    ON election_snapshots (town_id, election_date, raw_hash);

CREATE TABLE IF NOT EXISTS election_results (
    snapshot_id   BIGINT NOT NULL REFERENCES election_snapshots(id),
    contest_id    BIGINT NOT NULL REFERENCES election_contests(id),
    choice_name   TEXT NOT NULL,
    choice_order  INTEGER NOT NULL,
    votes         INTEGER NOT NULL CHECK (votes >= 0),
    -- Recomputed from votes by us (rounded to 0.1), never copied from the source.
    pct           NUMERIC(5,1) NOT NULL,
    PRIMARY KEY (snapshot_id, contest_id, choice_order)
);

CREATE TABLE IF NOT EXISTS election_turnout (
    snapshot_id         BIGINT PRIMARY KEY REFERENCES election_snapshots(id),
    ballots_counted     INTEGER CHECK (ballots_counted >= 0),
    registered          INTEGER CHECK (registered >= 0),
    precincts_reporting INTEGER,
    precincts_total     INTEGER
);

COMMIT;
