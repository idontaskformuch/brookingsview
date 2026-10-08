# State

Master spec: HANDOFF_journey_cleanup_events.md -- not on disk, in-context copy.
Current: Step A (pre-Phase-2 cleanup), handoff 2026-10-08.

## Step A progress
1-2 done (meta.when confirmed INERT, left alone).
3 DONE (e6ba48c): meta.cost/audience wired into cards+/s/[slug];
isFreeEvent() fixed (meta.cost checked now too, both languages).
4 DONE (d6411d1): rejection report script. New date/time/price/age
guardrail: 4 rejections, all true positives, 0 FPs -- not narrowed.
5-6 NOT STARTED (5 needs owner approval before any live write).

## Known residuals (owner aware, logged not dropped)
- 4 rows still template_fallback (incl. "Corpse Bride").
- 2 is_recurring_series rows need a full merge rebuild -- skipped. Same 2
  fail live on "must" opinion-marker FP (blanket substring, no grammar
  context, 36 live rejections both towns) AND event-series-redirects.
  test.ts's pre-existing slug-pattern failure. One investigation, point 5.
- Found, separate: 44 brookings_sd rejections since 10-02, pre_publish_
  check weekday/title mismatch, maybe a stale county_alert row misrouted
  as 'event' -- root cause not found, own follow-up, not point 5.
- 11 duplicate-title groups lack a canonical series row.
- Venue-name-dropping (ICS feeds): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Next
Step A point 5 (dry-run list, ask before any live write), then 6. Then
Phase 2 starting with 2d.
