# State

Master spec: HANDOFF_journey_cleanup_events.md (current phase only) -- not found on disk, using in-context copy from conversation
Current: Phase 1, Events correctness (handoff given in-conversation, no file)

## Status
- Phase 0: DONE, pushed (1cc6055)
- Broomfield /this-week + event-facet sitemap fix: DONE (parallel session), in origin/main
- Phase 1.1 Timezone bug: DONE, committed (28d1128). Full verify passed (vitest 845, pytest 716/8 skip, astro check 0 err, all 3 builds + sitemap-disjoint clean: Brookings 104, MoVal 133, Broomfield 77).
- Phase 1.2 30-event audit: NOT DONE -- 2 agents hit session rate limit (resets 1:30 Stockholm). Broomfield has 0 events (webtrac source disabled) -- audit impossible there, Phase-2d scope instead.
- Phase 1.3 Recurring-event merge: DONE, committed (a52227b). 1021 rows superseded live in DB. Same full verify as above, passed.
- Not committed: CLAUDE.md (ac3805b) + state.md (5dd94ac) already landed separately, see git log.

## Decisions and why
- 2 timezone bugs, not 1: index.astro's homepage river (build-machine-UTC day math) AND publish.py's fmt_dt() (never tz-converted the date half) -- fmt_dt corrupts published article text, likely the real root cause of the original report.
- Recurring dupes: group_recurring_events() only sees one run's batch, not earlier-published rows. Fixed via superseded_by_slug column + redirect map (keep data, stop rendering), never deletion.
- Only merge into an EXISTING is_recurring_series row; never invent a new canonical slug.
- Reused resolveLegacyMeetingRedirect() for the new redirect map, no new function written.
- Task 1 and 3 committed as separate commits (not "one Phase 1 commit") per the new CLAUDE.md rule 1 ("committa efter varje deluppgift"), installed mid-phase.

## Known issues
- 11 event-program groups have no canonical series row yet (8 Brookings, 3 MoVal); biggest: MoVal "Lunch at the Library" (16 dupes still live). Rerun scripts/merge_recurring_event_duplicates.py later.
- Local stash "superseded-broomfield-draft": confirmed fully superseded, owner will drop it, DO NOT TOUCH.

## Next
Retry Phase 1.2 (30-event audit, Brookings + Moreno Valley only) once the rate limit resets. Then git fetch/pull --rebase, rerun tests, wait for push approval.
