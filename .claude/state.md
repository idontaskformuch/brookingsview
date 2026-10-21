2026-10-20 (NY SESSION): spec .claude/spec-time-alerts-heroes.md (inkl. Fas 6
  dark mode, startar först när Fas 1-5 godkända+committade). Allt ocommittat.
  FAS 1 + FAS 2 KODADE, väntar ägarens godkännande (ingen commit/push).
  BESLUT: ingen ny cron; Today/Tonight klientberäknas; "as of"->"Updated";
  county_alert med category 'Hazardous Weather Alerts' filtreras bort ur
  varningsytorna, gamla county_alert (>24h) når aldrig ytorna; ends_at NULL
  -> dölj efter 24 h; bara 📅 byts i Fas 3 (övriga ikon-emojier listas då);
  Fas 4 återanvänder selectThisWeekImage.
  Fas 1 filer: lib/{alerts,local-day}.ts(+test), db.ts, events.ts,
  cityStatus.ts, TodayBlock/CityStatus/StoryCard/Lead/Secondary, BaseLayout,
  pages/{today,index,events/[facet]}.astro.
  Fas 2: lib/site-config.ts hasHeatAdvisory (bara MV), HeatAdvisoryWidget
  (bara vid caution/high-risk), lib/status-tokens.mjs (källa) ->
  public/status-tokens.css (genererad, gitignorad) + lib/status-contrast.ts
  (bygget fallerar <4.5/3:1), scripts/verify_heat_advisory_leak.mjs.
  ROTORSAK mintgrönt: dark-mode-override av --status-good låg på en ljus sida
  (inget dark theme finns) -> mint på mint. Overriden borttagen; Fas 6 lägger
  tillbaka dark-värden via STATUS_TOKENS.dark.
  Verifierat: vitest 1087 (UTC+Stockholm), pytest 878, astro check 0 fel,
  3 byggen OK, sitemap/noindex-disjoint OK x3, heat-läckage OK.
  KÄND RESTPOST: widgetens scopade CSS (inert) följer med i Brookings/
  Broomfield-bygget; text+markup läcker inte.
  Ej gjort: skärmbilder före/efter. NÄSTA: godkännande -> commit, sen Fas 3.

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
