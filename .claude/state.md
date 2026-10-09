# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3 DONE+PUSHED (8d576a2). Owner approved all 3 follow-up parts +
Phase 5; this round's work committed (debb579, 4539891, 24711a2,
371c85e, 09c279e), NOT yet pushed. Verifying 3-town builds before
final phase-end report.

## Done this round
- Redirect audit: clean, no fix needed.
- Brookings: 3 alias fixes + SD Art/Ag museums + Larson Ice Center
  (no hours, city page linked) LIVE in places table (debb579). Alert
  rows (NWS) no longer get a venue_raw at all. Children's Museum of
  South Dakota (521 4th St) dry-run NOT yet executed -- awaiting a
  separate go-ahead, per the owner's own "as a dry run" phrasing.
  University Plains Speedway: researched (thin/seasonal, non-local
  phone), recommended no page, none created. 824 32nd Ave: left
  unmatched. "Hazardous Weather Alerts"/county-list strings: fixed at
  the source (_venue_eligible() in publish.py) -- NOT backfilled on
  the 4 existing live rows yet, dry-run SQL ready if wanted.
- Traffic (4539891): In-Town/Approach-roads via real boundary distance
  + named corridors, 8mi cap (empirically chosen). Jobs (24711a2),
  Home Sales (371c85e), Sports rename (09c279e). All verified live on
  a Moreno Valley build.
- About/Editorial Policy: audited, already compliant, excerpt shown
  to owner in chat, no file changes.

## Next
Broomfield + Brookings verify builds running (disjoint check pending).
Then: full test suite once more, push, final phase-end report, STOP.
