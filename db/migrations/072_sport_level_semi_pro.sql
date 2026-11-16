-- Local sports: level 'semi-pro' (owner 2026-11-16, option b; Queen's Park Women in SWPL). Widens the two CHECK lists from 066,
-- which stays as it was; NOT NULL on sport_events.level is untouched. Every existing row passes the wider list.
-- The list must equal config/sports.json "levels" (tests/test_sports_core.py checks it).
-- Each DROP is directly followed by its ADD; apply_migration runs the file in one transaction, so neither table is ever unchecked.
-- Apply: python -m scripts.apply_migration 072_sport_level_semi_pro --prod   (ALLOW_PROD_WRITE=apply_migration, same-day backup first, the owner's own yes: CLAUDE.md rule 14)
ALTER TABLE sport_events DROP CONSTRAINT sport_events_level_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_level_check CHECK (level IN ('pro','minor','semi-pro','college','varsity','jv','amateur','youth'));
ALTER TABLE sport_programs DROP CONSTRAINT sport_programs_level_default_check;
ALTER TABLE sport_programs ADD CONSTRAINT sport_programs_level_default_check CHECK (level_default IN ('pro','minor','semi-pro','college','varsity','jv','amateur','youth'));
