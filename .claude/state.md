# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3+5 DONE+PUSHED. Phase 4 ("Add to calendar") DONE+PUSHED+LIVE-
VERIFIED (through e81d1c8). About page MV/Broomfield restructure DONE,
1 commit NOT YET PUSHED -- awaiting owner approval.

## This round, pushed+live (origin now at e81d1c8)
Children's Museum of SD live; alert venue_raw backfill; About opening
rewrite (Brookings); Phase 4 .ics. Live-verified on morenovalleyview.com:
curled a real event's .ics, Content-Type text/calendar (200), raw
bytes confirm CRLF+UTF-8; sitemap-0.xml has 0 .ics URLs (135, unchanged).
Note: Cloudflare drops the ";charset=utf-8" I set, serves bare
"text/calendar" -- bytes still correct UTF-8, functionally fine.

## Unpushed (HEAD is dacd9b8, origin is e81d1c8)
- dacd9b8: About page, same restructure for Moreno Valley + Broomfield
  (owner's own text for each town's opening, shared "why this exists"
  paragraph kept, no new facts added). Built+verified both towns live
  (sitemap unchanged 135/77, disjoint clean, text confirmed rendered).
  NOT PUSHED -- awaiting go-ahead.

## Verification (DONE)
981 vitest, astro check 0 errors (clean dist dirs). pytest unaffected.

## Next
Awaiting owner push approval for dacd9b8. Then stop + report per
instruction. Phase 6 starts separately, not this round.
