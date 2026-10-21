-- Kö 6, step 3: the database itself refuses a second meetings row for the
-- same eSCRIBE meeting. Run ONLY after
-- scripts/merge_duplicate_meetings_by_source_id.py --apply has merged the 12
-- existing duplicate groups (applied 2026-10-21); with duplicates left the
-- CREATE fails with a uniqueness violation, by design.
--
-- Why this exists: UNIQUE (town_id, content_hash) is not an identity -- the
-- hash changes whenever its inputs do, and a timezone fix made every
-- already-stored Moreno Valley meeting insert a second row (meetings
-- 13779-13791, 2026-10-01; again 14586 and 14970 on 10-15/10-20). The scraper
-- now dedupes on the source's own id (db.upsert_records identity_key); this
-- is the backstop if that is ever bypassed.
--
-- Scope: one index per source's own id key, for parity -- eSCRIBE 'ID'
-- (Moreno Valley), Legistar 'EventId' (Brookings), AgendaLink 'id' (Broomfield).
-- Keys are case-sensitive and each town's rows carry only its own key, so
-- ->> yields NULL for the other two and Postgres treats NULLs as distinct:
-- no index touches another town's rows. Plain (non-partial) indexes suffice.
-- Verified 2026-10-21 before applying: 0 duplicate groups for any of the three
-- keys in any town (rows with key: Moreno 'ID' 34, Brookings 'EventId' 93,
-- Broomfield 'id' 34).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_town_source_id_unique
    ON meetings (town_id, (raw_data->>'ID'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_town_event_id_unique
    ON meetings (town_id, (raw_data->>'EventId'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_town_lc_id_unique
    ON meetings (town_id, (raw_data->>'id'));

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/060_meetings_source_id_unique.sql
