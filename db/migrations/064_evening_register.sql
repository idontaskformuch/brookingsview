-- Curated venue register for /tonight (steg 6, .claude/specs/weekend-layer.md "Registret"). New tables only, no existing data touched.
-- Written weekly by scripts/refresh_evening_register.py (venue list lives in configs/<town>.json "evening_register").
--
-- evening_register_venues: one row per venue = outcome of the last check. A venue with status 'flagged' (identity check failed:
-- name missing from the page, hijacked/parked domain, redirect to another domain) stays flagged until the owner unflags it; the
-- site shows nothing from it and never links to it. 'skipped' = robots.txt names an AI crawler / disallows us / was unreachable.
CREATE TABLE IF NOT EXISTS evening_register_venues (
    town_id        TEXT NOT NULL,
    venue_id       TEXT NOT NULL,
    name           TEXT NOT NULL,
    url            TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('ok', 'flagged', 'skipped')),
    status_reason  TEXT,
    checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at     TIMESTAMPTZ,
    PRIMARY KEY (town_id, venue_id)
);

-- evening_register_entries: structured rules Haiku read off the venue page and the script validated against the page text.
-- Nothing here is prose shown to readers: title, weekdays/date, times, price, age label, and the venue's own link (source_url).
-- `evidence` is the verbatim quote that supports the rule (audit only, never rendered). Freshness is enforced by the site build:
-- kind 'dated' is dropped unless last_confirmed_at is within 7 days, kind 'recurring' within 35 days (owner 2026-10-29).
CREATE TABLE IF NOT EXISTS evening_register_entries (
    id                 BIGSERIAL PRIMARY KEY,
    town_id            TEXT NOT NULL,
    venue_id           TEXT NOT NULL,
    entry_key          TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('recurring', 'dated')),
    title              TEXT NOT NULL,
    weekdays           SMALLINT[] NOT NULL DEFAULT '{}',   -- ISO 1 = Monday .. 7 = Sunday, recurring only
    on_date            DATE,                               -- dated only (venue-local date)
    times              TEXT[] NOT NULL,                    -- 'HH:MM' venue-local, ascending; several = one row per film/night
    price              TEXT,                               -- 'Free' or a quoted amount, taken from the evidence by code
    age                TEXT,                               -- '18+' | 'All ages' | NULL, taken from the evidence by code
    default_group      TEXT NOT NULL,
    source_url         TEXT NOT NULL,
    evidence           TEXT NOT NULL,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Never deleted (owner 2026-10-29: keep the data for analysis). A rule not confirmed for 60 days is set inactive;
    -- the venue page showing it again sets it active. The site reads active rows only.
    active             BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (town_id, venue_id, entry_key),
    FOREIGN KEY (town_id, venue_id) REFERENCES evening_register_venues (town_id, venue_id)
);
CREATE INDEX IF NOT EXISTS evening_register_entries_town_idx ON evening_register_entries (town_id, active, last_confirmed_at);

-- One row per event detail page the job has fetched (owner 2026-10-29: at most one fetch per event page per day, at most 10 per venue
-- and run, only when the list page shows no times). The job skips a URL fetched in the last 24 hours.
CREATE TABLE IF NOT EXISTS evening_register_detail_fetches (
    url        TEXT PRIMARY KEY,
    town_id    TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

