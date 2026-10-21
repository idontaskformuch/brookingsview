2026-10-21 (spec .claude/spec-time-alerts-heroes.md). Fas 1+2 godkända och
  committade (8980ee1, cd17e85) + render-test (a3e92ca). INGET PUSHAT: ägaren
  vill pusha allt i ett svep när Fas 5 är verifierad (en omcrawlning).
  Fas 3 (📅 -> DateBadge.astro) committad 615ad2d. Fas 4 (lib/section-hero.ts:
  getSectionHero, SectionHero.astro, hero på /today + Farm Report) committad.
  Fas 4 BEGRÄNSNING: pooler ~15/säsong/stad räcker inte för 2-månadersregeln
  (kräver 9 v x ~9 sektioner); build-check varnar med exakta tal. Spring/summer
  saknar pool -> reserv (kategoribild). Borttagna bilder: Brookings events-1/2,
  city_hall-1/4; Moreno events-3, city_hall-2, school_alerts-3.
  Fas 5 (stavning organizer/summarized/theater, konsekvent event-kicker
  'Around Town'/'Arts & Culture') committad. Full batteri grön: vitest 1113
  (UTC+Stockholm), pytest 878, astro check 0, 3 byggen, sitemap/noindex x3,
  heat-läckage x3. Ägaren beordrade push i ett svep efter verifierad Fas 5.
  Inga skärmbilder (ägaren kollar på telefon efter push). Fas 6 dark mode först
  efter Fas 1-5 godkända+committade; STATUS_TOKENS.dark läggs då till.
  ÖVRIGA ikon-emojier kvar för senare (ej Fas 3): StoryCard CHIP (🏛️🚗🏠💼🏈🎒⚠️
  🏭🎓), widgetar (🐴📊🏔️🐇), university.astro (🎵🎭🎉🏕️ + sport-emojis),
  📍 (s/[slug], city-hall/projects), 🏟️ (events), 📦 (weather).
  Känd restpost: HeatAdvisoryWidget scopad CSS (inert) finns i alla byggen.

2026-10-16. merge_raw_data fix + restore built, tested, run, and about
  to be pushed (this commit). Moreno Valley duplicate-row cleanup
  SKIPPED this session -- see NEXT STEP. No full pre-push battery
  (astro check/3-town build/sitemap) run for this change -- owner said
  "gör inget mer" after confirming the push; it's a pure backend/DB
  change (scraper + one-off script), no site/build code touched.

DONE, pushed with this commit:
  - db.upsert_records() new opt-in merge_raw_data=True param: raw_data
    merges (jsonb ||) instead of blind-replacing on rescrape. Default
    False, zero change for ~10 other existing callers.
  - LegistarParser/AgendaLinkParser/EscribeParser set merge_raw_data=True
    (base_parser.py new attribute, runner.py reads it generically).
  - Tests added (test_db_upsert_dedup.py, merge SQL shape + regression
    safety) and test_runner_doc_errors.py's fake db stub fixed (missing
    kwarg). Full pytest green (878 passed, 8 skipped) before this push.
  - scripts/restore_legistar_agenda_from_snapshot.py: dry-run shown,
    owner approved, RAN for real against production. Restored 9
    Brookings meetings' agenda_items/agenda_text from their last known-
    good source_snapshots entry (merge, not overwrite). Verified live in
    DB (all 9 now have the expected item counts: 1314=6, 2428=6,
    10737=14, 10811=10, 10969=14, 10971=4, 10973=6, 11006=6, 11009=6).
    13 other candidates reported, correctly left untouched (3 predate
    the snapshot archive, 10 genuinely never had items).

SKIPPED THIS SESSION, owner's explicit call ("Skippa dubbletterna"):
  Moreno Valley duplicate meetings rows (2193/13786, 2194/13788 pairs --
  same real eSCRIBE meeting, duplicate row under a different content_hash,
  most likely from an un-tracked one-off backfill script around the Oct 1
  "mass insert" that bypassed dedup_check_columns -- see prior investigation
  for full reasoning). Confirmed safe to delete 13786+13788 (keep the
  older 2193+2194): zero references from stories, meeting_decisions,
  project_updates, project_match_review_queue, project_new_candidate_queue,
  or project_updates_checkpoints. Attempting to write/run the DELETE was
  blocked by Claude Code's own safety classifier (flagged as a dangerous
  action, generic reason given); did not attempt a workaround per that
  denial's own instructions -- handed the decision back to the owner
  instead of retrying through another tool/script.

NEXT STEP: Moreno Valley duplicate-row cleanup is still open. Owner can
  either run this directly against the DB, or add a permission rule
  that lets a scripted DELETE through and ask for a retry:
    DELETE FROM meetings WHERE id = 13786;  -- duplicate of 2193 (kept)
    DELETE FROM meetings WHERE id = 13788;  -- duplicate of 2194 (kept)
  No other table references either row (confirmed above) -- safe
  whenever the owner wants to act on it. Not scheduled/blocking anything
  else.

PRE-EXISTING OPEN ITEMS, unchanged: QA finding #9 (Celebration Park
  hours, Moreno Valley, info-only, lowest priority) -- not scheduled.
