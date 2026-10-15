# State

2026-10-15. Commit cdf1cb0 (title/H1 + Open/Closed badge client-side
  move) built+verified, NOT PUSHED. Stacked on d558596+17c7ca2 (Fas 9 +
  053-closure), also NOT PUSHED -- push needs separate yes (rule 9).

DONE (cdf1cb0): /events,/weather,/closures title+H1 via existing
  TOWN_OVERRIDES hook (Bing data) -- config-only. Open/Closed badge
  (facilities/[slug].astro, facilities/index.astro, TodayBlock.astro
  city-hall) moved build-time->client <script> (ShareButton.astro
  pattern) -- was stale up to 6h (scrape.yml cron). Same
  computePlaceOpenStatus/computeOpenStatus, unchanged; extracted
  calendarDateParts into new dependency-free lib/calendar-date.ts so
  place-hours.ts is bundle-safe (db.ts calls neon() at module load).
  Verified end-to-end against real dist/ output + live Date(). Found+fixed
  one unrelated bug: a quote split across two // lines corrupted TS
  inference elsewhere in TodayBlock.astro (Astro-checker quirk). vitest
  1021/1021, astro check 0 errors, all 3 towns build clean, sitemap OK.

PENDING (shown, NOT run -- owner reviewing, each needs separate yes,
  rule 7): migration 059 (docs_by_type JSONB, draft uncommitted at
  db/migrations/059_scrape_runs_docs_by_type.sql); Briggs Library
  hours_text UPDATE (SDSU confirmed, not San Diego State); Larson Nature
  Center dry-run INSERT (new places row, category='other', real
  address/phone/seasonal hours) -- cross-link into dakota-nature-park
  flagged as plain-text only, no template change made.

OPEN (carried): Candidate #42 (Line F Detention Basin, queue id=42).
NEXT: owner approves/declines 059 + both SQL writes; push after yes.
