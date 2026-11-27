-- Owner 2026-11-27: one meaning per place_hours row. A row with opens/closes NULL means CLOSED that day, except when time_unknown
-- is set: the source gives the day but no clock time (/help/ rows from a monthly pattern, e.g. cross-of-christ-community-meals).
-- Default false, so every existing row keeps its meaning. Readers: site/src/lib/place-hours-time-unknown.test.ts (site) and
-- tests/test_place_hours_time_unknown.py (Python) list each one and how it treats the marker.
ALTER TABLE place_hours ADD COLUMN IF NOT EXISTS time_unknown BOOLEAN NOT NULL DEFAULT false;
