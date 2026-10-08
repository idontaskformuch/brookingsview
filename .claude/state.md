# State

Master spec: HANDOFF_journey_cleanup_events.md -- not on disk, in-context copy.
Current: Step A (pre-Phase-2 cleanup), handoff 2026-10-08.

## Step A progress
1. done. 2. meta.when: confirmed INERT (nothing reads stories.meta; Story
type didn't expose it) -- left alone per handoff.
3. DONE (e6ba48c): wired meta.cost/audience into cards + /s/[slug]
(Story.meta/EventMeta, eventPriceAgeLine()); fixed isFreeEvent() +
free_teasers.py's is_free_event() -- prose can't carry a price anymore
(Phase 1 guardrail) so the old $-safety-net was dead; meta.cost checked now.
4-6 NOT STARTED: guardrail FP review; Corpse Bride + 2 recurring-series rows
(owner approval needed before any live write); Phase 0 live check.

## Known residuals (owner aware, logged not dropped)
- 4 rows still template_fallback (incl. "Corpse Bride").
- 2 is_recurring_series rows need a full merge rebuild -- skipped. Likely
  cause of event-series-redirects.test.ts's pre-existing failure on clean
  main (one canonical slug doesn't match /^event-series-/) -- check point 5.
- 11 duplicate-title groups lack a canonical series row.
- Venue-name-dropping (ICS feeds): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Next
Step A point 4, then 5, 6. Then Phase 2 starting with 2d.
