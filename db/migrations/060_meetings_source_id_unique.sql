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
-- Scope: eSCRIBE's raw_data key is 'ID'. Legistar rows (EventId) and AgendaLink
-- rows (id, lowercase) have no 'ID' key, so ->> yields NULL and Postgres
-- treats NULLs as distinct: those towns are unaffected. A plain (non-
-- partial) index is therefore enough. (Brookings/Broomfield: 0 duplicates by
-- their own keys, checked 2026-10-21.)

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_town_source_id_unique
    ON meetings (town_id, (raw_data->>'ID'));

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/060_meetings_source_id_unique.sql
