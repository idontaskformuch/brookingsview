# State

Master spec: HANDOFF_journey_cleanup_events.md -- not on disk, in-context copy.
Current: Step A (pre-Phase-2 cleanup) COMPLETE. GA4 added out-of-band
(owner priority, 2026-10-08). Next session starts Phase 2.

## GA4 (b4621b6) -- DONE, all 3 towns, Mediavine Journey verification
site-config.ts's ga4MeasurementId (Brookings G-0K3RL2H501, Moreno Valley
G-5KH1S9H8SB, Broomfield G-L7JGXKQVNV); BaseLayout.astro renders it
consent-gated like the existing AdSense script (same bvConsent mechanism),
PROD-only. privacy.astro/cookies.astro updated so "we don't run analytics"
no longer reads false. No CSP exists anywhere -- nothing to change there.
Verified zero cross-town ID leakage across 3 fully isolated --outDir
builds (concurrent attempt corrupted via shared .astro/ cache -- redone
sequentially). Not pushed.

## Step A -- all 6 points done
1-2: meta.when confirmed INERT -- left alone. 3 (e6ba48c): meta.cost/
audience wired into cards+/s/[slug]; isFreeEvent() fixed. 4 (d6411d1):
rejection report script -- new date/time/price/age guardrail has 0 FPs.
5 (12b787c, owner-approved): Corpse Bride + library-hours text fixed live;
"A New Brain" left untouched (no real error). Also (7310959) fixed a wrong
test assumption in event-series-redirects.test.ts.
6: live-checked all 3 towns -- sitemap counts match build (105/133/77);
old content-track pages noindex+out of sitemap; homepage clean. Minor,
non-blocking: morenovalleyview.com/reviews/ serves bare "noindex" (likely
stale deploy for that one page).

## Known residuals (owner aware, logged not dropped)
- 3 rows still template_fallback.
- "must" opinion-marker: blanket substring, no grammar context, real FP
  risk (36 live rejections both towns), not yet narrowed.
- 44 brookings_sd rejections since 10-02: pre_publish_check weekday/title
  mismatch, maybe a stale county_alert row misrouted as 'event' -- own
  follow-up, root cause not found.
- 11 duplicate-title groups lack a canonical series row.
- Venue-name-dropping (ICS feeds): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Next
Phase 2, starting with 2d (Broomfield event source), then 2a-2c, 2f.
