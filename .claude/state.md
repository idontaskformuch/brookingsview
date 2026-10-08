# State

Master spec: HANDOFF_journey_cleanup_events.md (current phase only) -- not found on disk, using in-context copy from conversation
Current: Phase 1, Events correctness (handoff given in-conversation, no file)

## Status
- Phase 0: DONE, pushed (1cc6055)
- Broomfield /this-week + event-facet sitemap fix: DONE (parallel session), in origin/main
- Phase 1.1 Timezone bug: CODE+TESTS DONE (vitest/pytest green). Build+sitemap-disjoint re-verify pending.
- Phase 1.2 30-event audit: NOT DONE -- 2 agents hit session rate limit (resets 1:30 Stockholm). Broomfield has 0 events (webtrac source disabled) -- audit impossible there, Phase-2d scope instead.
- Phase 1.3 Recurring-event merge: CODE+DATA DONE, 1021 rows superseded live in DB. Build+sitemap re-verify pending.

## Decisions and why
- 2 timezone bugs, not 1: index.astro's homepage river (build-machine-UTC day math) AND publish.py's fmt_dt() (never tz-converted the date half) -- fmt_dt corrupts published article text, likely the real root cause of the original report.
- Recurring dupes: group_recurring_events() only sees one run's batch, not earlier-published rows. Fixed via superseded_by_slug column + redirect map (keep data, stop rendering), never deletion.
- Only merge into an EXISTING is_recurring_series row; never invent a new canonical slug.
- Reused resolveLegacyMeetingRedirect() for the new redirect map, no new function written.

## Known issues
- 11 event-program groups have no canonical series row yet (8 Brookings, 3 MoVal); biggest: MoVal "Lunch at the Library" (16 dupes still live). Rerun scripts/merge_recurring_event_duplicates.py later.
- Local stash "superseded-broomfield-draft": confirmed fully superseded, owner will drop it, DO NOT TOUCH.

## Changed files (uncommitted Phase 1)
ai_pipeline/publish.py, tests/test_publish_timezone.py, site/astro.config.mjs, site/src/lib/{db,events,events.test}.ts, site/src/pages/{index,rss.xml}.{astro,ts}, site/server/worker.ts; new: db/migrations/051_*.sql, scripts/merge_recurring_event_duplicates.py, site/server/event-series-redirects.{json,test.ts}

## Next
Rebuild all 3 towns + verify_sitemap_noindex_disjoint.mjs + full vitest/pytest/astro-check, then ONE Phase 1 commit (not pushed). Task 2 audit after rate limit resets.
