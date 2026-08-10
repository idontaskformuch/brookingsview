-- 014_academic_calendar.sql
--
-- SDSU:s akademiska nyckeldatum (terminsstart, lov, tentaperioder,
-- examen) för Brookings -- HANDKURERAT, ingen scraper. Samma "manuell fil,
-- inget HTTP-anrop"-mönster som facilities (se db/migrations/007) och
-- scripts/seed_facilities.py: ändras bara ett par gånger per år
-- (terminsvis), en människa läser av sdstate.edu/academics/academic-calendar
-- och redigerar data/academic_calendar/<town_id>.json, sen körs
-- scripts/seed_academic_calendar.py. Ingen hourly-pipeline-plats för något
-- som ändras två gånger om året.
--
-- Används av /university.astro:s "next up"-ribbon (bara de 1-2 närmaste
-- datumen visas, inte en full tabell -- se lib/db.ts:getUpcomingAcademicDates).
--
-- starts_on/ends_on   rena kalenderdatum (samma lagringsform som
--                      meeting_date/sale_date) -- formatera med
--                      formatCalendarDate(), inte formatDate(), annars
--                      skiftar datumet bakåt en dag.
-- ends_on              NULL för en enskild dag (t.ex. "Labor Day holiday"),
--                       satt för intervall (t.ex. "Final exams Dec 10-16").
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/014_academic_calendar.sql

BEGIN;

CREATE TABLE IF NOT EXISTS academic_calendar_dates (
    id            BIGSERIAL PRIMARY KEY,
    town_id       TEXT NOT NULL REFERENCES towns(town_id),
    label         TEXT NOT NULL,
    term          TEXT,
    category      TEXT,           -- 'term_start' | 'term_end' | 'holiday' | 'break' | 'exam' | 'deadline' | 'commencement'
    starts_on     DATE NOT NULL,
    ends_on       DATE,
    source_url    TEXT,
    verified_date DATE,
    content_hash  TEXT NOT NULL,
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (town_id, label, starts_on)
);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_town_starts ON academic_calendar_dates (town_id, starts_on);

COMMIT;
