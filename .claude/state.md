# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3 DONE+PUSHED (8d576a2). Owner approved all 3 follow-up parts +
Phase 5; this round's work committed+pushed (debb579, 4539891,
24711a2, 371c85e, 09c279e). Phase 5 DONE, stopped per spec+owner.

## Done this round
- Redirect audit: clean, no fix needed.
- Brookings (debb579): 3 alias fixes + SD Art/Ag museums + Larson Ice
  Center (no hours, city page linked) LIVE in places. Alert rows (NWS)
  no longer get a venue_raw (_venue_eligible() in publish.py). GATED,
  NOT executed: Children's Museum of SD dry-run, backfill on the 4
  existing live alert rows. University Plains Speedway: researched,
  no page (thin/seasonal). 824 32nd Ave: left unmatched.
- Traffic (4539891): In-Town/Approach-roads via real boundary distance
  + named corridors, 8mi cap (empirically chosen, real stored data).
- Jobs (24711a2), Home Sales (371c85e), Sports rename (09c279e).
- About/Editorial Policy: audited, already compliant, excerpt shown
  to owner, no file changes.

## Verification (DONE)
961 vitest, 729 pytest (8 skip), astro check 0 errors. Real builds all
3 towns: sitemaps unchanged (108/134/77), disjoint clean. Broomfield's
"no active incidents" empty state double-checked against the DB --
real, not a classification bug.

## Next
Phase 6 awaits separate go-ahead. Gated items above still open.
