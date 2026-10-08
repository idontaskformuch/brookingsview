# State

Current spec: .claude/phase2-spec.md. Step A + Phase 2 items 2d/2a/2b
done. Pushed through bea8846 (2d+2a+fixes); 2b (80910c2) NOT pushed yet.
Next: owner reviews 2b, then 2c or 2f per phase2-spec.md.

## Phase 2, item 2d -- CLOSED, owner declined the live run (75d4db6, pushed)
Broomfield: no clean event source found. webtrac/compass/chamber all
`kind:"blocked"`; data_sources.events.enabled back to `false` --
confirmed no scheduled job can fetch any of them. Zero events until a
real source turns up. Kept as documented dead end, not deleted.

## Phase 2, item 2a -- done (de79552, pushed), two fixes on top (pushed)
1. Weekend-hero bug (a653391): old anchor formula broke on Saturday.
   Fixed: shared weekendAnchorOffset(), 31 new tests.
2. Locality text-fallback safety (5389b13, owner-requested): an
   unresolved address-shaped venue naming a different place no longer
   confidently returns "nearby" with an unverifiable distance -- now
   "unknown" (excluded). Added a `method` tag + per-build `[locality]`
   console count. Prepared (NOT run) a real `places` row for Moreno
   Valley's Farm House Collective in data/facilities/
   moreno_valley_ca.json (dry-run printed the exact UPSERT params) --
   STILL awaiting owner go-ahead to run `python -m scripts.
   seed_facilities moreno_valley_ca` (live-DB write, rule 7). Until
   that runs, Moreno Valley's Nearby section is empty (16/28 events
   excluded as unknown, correctly -- not a regression).
390px verified live (Playwright), no horizontal scroll. Brookings
Fri4/Sat3/Sun4 cross-checked against real SDSU + McCrory Gardens pages.

## Phase 2, item 2b -- done (80910c2), NOT pushed
Homepage "This weekend" module in the slot Phase 0 froze: Fri/Sat/Sun
counts + top 3-5 in-town events, links to /events/. New
buildWeekendSummary() (lib/events.ts) composes weekendAnchorOffset()/
dayIndex()/classifyEventLocality() -- no new date math, no new DB
query (reuses index.astro's existing quickLinkFeed/facilities). Returns
null (module hides) when nothing this weekend; gated on siteConfig.
hasEventsSource (Brookings/Moreno Valley only -- confirmed absent on a
real Broomfield build). Verified: 3 real builds, sitemap counts
unchanged (105/133/77), disjoint clean, Brookings homepage counts match
/events/'s own hero exactly (4/3/4). vitest 911 passed, pytest 726/8
skipped, astro check 0 errors.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Owner reviews 2b, approve push when ready. Separately, still open:
approve the Farm House Collective `places` seed (live-DB write).
Then 2c (search signals: ItemList JSON-LD, IndexNow) or 2f (facility
SERP pass) per phase2-spec.md's own order.
