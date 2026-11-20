-- Capital improvement projects from a city's own CIP list (Fas 5 source 2, owner 2026-11-20: Broomfield
-- https://www.broomfield.org/3763/Current-Capital-Improvement-Projects). Uses the existing projects / project_updates tables
-- (Story Threads), no parallel tables: a CIP project is a projects row with source_type = 'cip_page', and every change the
-- daily check sees between two runs is a dated project_updates row (source_type = 'cip_page', change_kind set).
--
-- projects (all new columns NULL on the existing, hand-curated registry rows; source_type NULL = registry):
--   source_type      'cip_page' for a row written by scrapers/parsers/capital_projects.py
--   source_url       the project's own page, exactly as the City's list links it
--   source_hash      hash of the EXTRACTED content (heading, Project Information, Timeline, Project Cost), not the raw HTML,
--                    so CMS tokens and timestamps do not count as a change (owner addition 1, 2026-11-20)
--   timeline         the Timeline lines, verbatim, each with what the parser could read from it:
--                    [{text, label, start, end, completed, tbd}]; start/end NULL when the line has no readable date range
--   cost_text        the first sentence with a $ amount under "Project Cost", verbatim; NULL when there is none
--   last_checked_at  the last run that read this project's page successfully (a failed read never moves it)
--   delisted_at      set when the project left the City's list; cleared if it comes back
-- project_updates:
--   change_kind      'new' | 'relisted' | 'removed' | 'phase_added' | 'phase_changed' | 'phase_removed' | 'cost_changed'
--                    (NULL on every meeting/traffic row). body holds the change in a fixed template with the source's words.
-- scrape_runs:
--   alert_sent_at    set on the run that sent the "parsing failed for more than 72 h" ntfy alert, so a failure streak alerts
--                    once (capital_projects.py after_upsert; same idea as restriction_checks.alert_sent_at in 073).
--
-- Written by scrapers/parsers/capital_projects.py only. No AI step reads or writes these columns; every existing projects query
-- (db.ts, astro.config.mjs, ai_pipeline/project_registry.py, project_threads.py) leaves source_type = 'cip_page' rows out.
-- Apply: python -m scripts.apply_migration 074_capital_projects --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup
-- first, the owner's own yes: CLAUDE.md rule 14). NOT run by the session that wrote it (owner 2026-11-20).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS timeline JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cost_text TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delisted_at TIMESTAMPTZ;
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS change_kind TEXT;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_projects_town_source_type ON projects (town_id, source_type);
