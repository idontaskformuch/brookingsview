# State

Master spec: HANDOFF_journey_cleanup_events.md (current phase only) -- not found on disk, using in-context copy from conversation
Current: Phase 1, Events correctness -- all 3 subtasks attempted, NOT fully "done" (see below)

## Status
- Phase 0: DONE, pushed (1cc6055)
- Phase 1.1 Timezone bug: DONE, committed (28d1128), verified (all 3 builds + sitemap-disjoint clean)
- Phase 1.3 Recurring-event merge: DONE, committed (a52227b), 1021 rows superseded live
- Phase 1.2 30-event audit: 78 real comparisons done (Brookings 42, MoVal 36; Broomfield N/A, 0 events). One fix committed (9b5c26e, bare-state-code venue). Several real findings NOT fixed -- see Known issues. "Zero date errors" done-criterion is NOT met: stale wrong-dated duplicates and old pre-fix body text are still live.

## Decisions and why
- 2 real timezone root causes (index.astro + publish.py's fmt_dt) -- both fixed+tested. A 3rd+ "mismatch" class the audits found (wrong weekday/date-range IN already-published body text) is confirmed STALE RESIDUE from rows published before the fix (checked published_at on every example) -- not a new bug, but the fix can't retroactively rewrite old text.
- Venue-name-dropping (Brookings chamber/visitbrookingssd ICS, ~18/42 rows): confirmed the SOURCE feed's own LOCATION field only has an address, no name -- not a parser bug, no paid geocoding allowed, left as-is (showing the real address, not guessing, already policy-compliant).
- Bare state-code venue ("SD"): real, narrow, fixed generically in event_sources.py + backfilled the 1 live row (town-wide, confirmed only 1).

## Known issues (found, NOT fixed -- owner decision needed)
- AI fabrication bypassing guardrails: MoVal "Free Food Giveaway" body invents "runs through mid-August" (really ongoing/2028+); "Corpse Bride" invents "All ages welcome"; Brookings "Cricut Workshop" invents a fake overnight span. Needs guardrail-tuning decision, not a quick fix.
- Stale wrong-dated un-merged duplicates: Brookings "BPN Oct Meetup-Fly Boy Donuts" (3 rows, 2 show the wrong date after an organizer correction); several MoVal Farm House Collective exact-duplicate pairs. Root cause: re-scraping a corrected source doesn't retire the old wrong row (different scrape, different hash) -- a scraper/publish idempotency gap, bigger than a parser fix.
- One occurs_at data-integrity anomaly found (MoVal "Libraries Close Early," same UID scraped 3x with 2 different stored offsets) -- smoking-gun evidence in state but not root-caused to a specific code fix.
- Old Brookings template_fallback batch (2026-07-18) has some real timed events with occurs_at=NULL.
- Stale pre-fix body text (dates/weekdays computed via the now-fixed fmt_dt bug, written into already-published articles before 2026-10-08): ~7+ confirmed examples across both towns. Fixing requires re-running AI generation on affected historical rows -- a cost/risk decision for the owner, not done.
- Local stash "superseded-broomfield-draft": confirmed fully superseded, owner will drop it, DO NOT TOUCH.

## Next
Report to owner: Phase 1 core (timezone + recurring-merge) is solid and committed; task 2's audit surfaced real findings beyond a quick fix. Owner decides: accept Phase 1 as substantially done and move to Phase 2 with these logged, or spend more budget on the idempotency/guardrail issues first. Then: git fetch/pull --rebase, rerun tests, wait for push approval.
