# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3 DONE+PUSHED. Phase 5 DONE+PUSHED (through 25582fe). Phase 4
DONE this round, 3 commits NOT YET PUSHED -- awaiting owner review of
the About page diff (explicit "pusha inte" instruction).

## Unpushed (HEAD is ea1cf51, origin is 25582fe)
- 2dd0b7f: Children's Museum of South Dakota added live to `places`
  (owner-approved, executed+verified). Also backfilled venue_raw NULL
  on the 4 live alert rows (DB write, no file diff for that part).
- da2dcd2: About page opening rewrite (owner's text, Brookings branch
  only + shared "How it is made" shortened for all towns). NOT PUSHED
  per explicit instruction -- show diff, wait for go-ahead.
- ea1cf51: Phase 4 "Add to calendar" -- per-event .ics (lib/ics.ts +
  s/[slug].ics.ts), UTC-only DTSTART (zero DST risk by construction),
  RFC 5545 escaping+folding, kept out of sitemap/robots.

## Verification (DONE)
981 vitest, astro check 0 errors (pytest unaffected, no .py touched).
Builds: Brookings (109 URLs, disjoint clean, .ics validated against
Python's icalendar lib, link renders on real future events); Broomfield
(77 URLs, correctly zero .ics -- no real events source). Moreno Valley
not rebuilt (ics.ts is town-agnostic, unit-tested per town already).

## Next
Awaiting owner: approve About page push; University Plains
Speedway/SR-91 already decided (no page / not included). Stop and
report per spec+owner instruction.
