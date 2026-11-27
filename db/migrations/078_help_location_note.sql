-- /help/ card fixes before push (owner 2026-11-27): the address is the street only; running text about where ("- Located at the
-- Veterans of Foreign Wars (VFW) building.", a building name) is its own field. requirements_note now holds short labels from
-- db/help_places.py REQUIREMENT_LABELS; the source text behind them is kept here as evidence and never shown.
ALTER TABLE places ADD COLUMN IF NOT EXISTS location_note TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS requirements_evidence TEXT;   -- one source line per label match, newline-separated
