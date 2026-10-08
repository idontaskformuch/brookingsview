# State

Master spec: HANDOFF_journey_cleanup_events.md -- not on disk, in-context copy.
Current: Step A (pre-Phase-2 cleanup), handoff 2026-10-08.

## Step A progress
1-2 done (meta.when confirmed INERT, left alone).
3 DONE (e6ba48c): meta.cost/audience wired into cards+/s/[slug];
isFreeEvent() fixed (meta.cost checked now too, both languages).
4 DONE (d6411d1): rejection report script. New date/time/price/age
guardrail: 4 rejections, all true positives, 0 FPs -- not narrowed.
5 DONE (12b787c, owner-approved live writes): Corpse Bride fabrication
dropped; library-hours "Saturday"->"Sunday" corrected. 3rd flagged row
("A New Brain") investigated, left untouched -- no actual error in its text.
Also fixed (7310959): event-series-redirects.test.ts's wrong assumption
that every entry targets a series page (some are legit indiv-to-indiv).
6 NOT STARTED: Phase 0 live check.

## Known residuals (owner aware, logged not dropped)
- 3 rows still template_fallback (was 4 -- Corpse Bride fixed above).
- "must" opinion-marker is a blanket substring match, no grammar context --
  36 live rejections both towns, real FP risk (not yet narrowed/fixed).
- 44 brookings_sd rejections since 10-02: pre_publish_check weekday/title
  mismatch, maybe a stale county_alert row misrouted as 'event' -- root
  cause not found, own follow-up.
- 11 duplicate-title groups lack a canonical series row.
- Venue-name-dropping (ICS feeds): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Next
Step A point 6 (Phase 0 live check). Then Phase 2 starting with 2d.
