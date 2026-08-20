-- 017_shift_poll.sql
--
-- No-login "how was your shift today?" poll for Worker Pulse / Workplace
-- Watch (site/src/pages/workplace-watch), Moreno Valley only. Fixed
-- question, four fixed options, no free text (see
-- site/functions/api/shift-poll-vote.ts) -- that's the entire anti-spam
-- design, no accounts, no moderation needed for this table.
--
-- One row PER VOTE, not a pre-aggregated counter: UNIQUE (town_id,
-- poll_date, ip_hash) is a natural, DB-level "one vote per person per day"
-- guard (a second vote from the same hashed IP is a silent no-op via
-- ON CONFLICT DO NOTHING) while still keeping the raw rows around, same
-- "store the detail, aggregate at read time" preference as the rest of
-- this schema (e.g. property_sales, sports_games) rather than committing
-- to a single derived number up front.
--
-- ip_hash is sha256(CF-Connecting-IP + a server-side salt), never the raw
-- IP -- dedup without storing anything identifying, consistent with this
-- site never having accounts or tracking cookies elsewhere.

BEGIN;

CREATE TABLE IF NOT EXISTS shift_poll_votes (
    id         BIGSERIAL PRIMARY KEY,
    town_id    TEXT NOT NULL REFERENCES towns(town_id),
    poll_date  DATE NOT NULL,
    option     TEXT NOT NULL,
    ip_hash    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, poll_date, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_shift_poll_votes_tally
    ON shift_poll_votes (town_id, poll_date, option);

COMMIT;
