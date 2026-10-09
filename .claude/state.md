# State

Current spec: .claude/spec-phases-3-9.md (read only the current phase).
Phase 3 ("Event <-> facility hub") DONE, all three towns, not yet pushed.
Also fixed: Moreno Valley's /reviews/ redirect (was noindexed /columns/,
now ->/).

## Phase 3 changes
- events.ts: new eventsAtVenue() + selectWeekendNearby(), siblings of
  getRelatedStories() -- NOT inside getRelatedContent() (that's a
  section-landing system, wrong fit; documented in code).
- facilities/[slug].astro: "Upcoming here" via eventsAtVenue(), capped 5
  + "See all events" link.
- s/[slug].astro: venue link now shows address/hours_text (no per-page
  getPlaceHours query, perf tradeoff). New sections: "Other events at
  this venue", "Also this weekend nearby/in <Town>".
- events.test.ts: +8 tests.

## Verified
945 vitest, 726 pytest, astro check 0 errors. Real builds all 3 towns:
sitemaps unchanged (105/134/77), disjoint clean. Rendered HTML spot-
checked on Brookings + Moreno Valley.

## Owner deliverable: unresolved venue_raw audit
Brookings 37/49 unresolved (bare addresses, Larson Ice Center x3, Pasque
x3, SD Art/Ag museums). Moreno Valley 0/11. Broomfield 0/0 (no events).

## Next
STOPPED per spec. Phase 5 is next in order but needs separate go-ahead.
Nothing pushed (rule 6).
