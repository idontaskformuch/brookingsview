2026-10-21 (spec .claude/spec-time-alerts-heroes.md). Fas 1-5 PUSHADE (32b8a1b),
  ägaren bekräftade på telefon. Lokala commits efter push, EJ pushade:
  c82bf26 Hobo Week -> campus-bucket (Python, självläker vid nästa scrape),
  077fb8c låga mobil-heroes + bort Badlands (Brookings autumn-08/09/10),
  c9de086 sektionshero byter månadsvis/högtid (2-månadersregeln gäller bara
  startsidans This week).
  ÖPPET (ägarens bildbeslut 2026-10-21):
  (a) Inget foto i fler än en stad: dubbletter kvar = Moreno school_alerts-4
      (=Brookings school_alerts-1) och Moreno sports-5 (=Brookings sports-4);
      Broomfields kategoripooler LÅNAR Moreno/Brookings-filer -> ska få egna
      (city_hall, jobs, traffic, weather_alert, workplace_watch + reserv för
      events/today). Verktyg: scripts/source_category_images.py (--montage;
      OBS --apply skriver om hela category-images.ts och återinför borttagna
      bilder om CATEGORY_SEARCHES inte synkas). Ej påbörjat.
  (b) PUNKT FÖR SIG, bygg inte nu: VÅR- och SOMMARPOOLER för "This week" +
      sektionshero (Brookings/Moreno/Broomfield) måste finnas före 1 mars 2027,
      annars faller heroes till kategori-reserv och startsidans This week
      kastar. Verktyg: scripts/source_this_week_images.py.
  (c) Ägarens fynd 1 (skyltremsan matchrad): utrett, rapporterat, väntar svar
      innan ändring. Fas 6 (dark mode) väntar tills (a) och (c) är klara.
  Känd: skyltremsans "in N days" (db.ts countdown) är byggräknad -- missad i
  Fas 1, ska bli klientberäknad.

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
