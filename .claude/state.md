# State

2026-10-15. Two PENDING proposals, nothing built (rule 8). Fas 9
  (d558596) + 053-closure (17c7ca2) still committed, NOT PUSHED (rule 9).

PENDING A -- 053 refinement: docs_by_type JSONB (per-type attempt/fail:
  agenda/minutes/action_summary escribe_v1, eventitems/votes legistar_v1)
  + critical_doc_types on FetchResult, so runner.py degrades when a
  CRITICAL type totally fails even if pooled total looks fine (real case
  id=12561: 3/3 action_summary failed, pooled 3/15 stayed 'ok'). Draft on
  disk, NOT committed/run: db/migrations/059_scrape_runs_docs_by_type.sql.

PENDING B -- Bing SEO pass. (1) /events,/weather,/closures title+H1 via
  existing TOWN_OVERRIDES hook (config/page-meta.ts), config-only --
  picked "{Town} Events Today & Weekend" (49/57/51 chars) over the
  literal ask (71 chars for MoVal, overflowed). (2) REAL BUG:
  facilities/[slug].astro's "Open now" badge computes in Astro
  frontmatter = BUILD TIME, stale up to 6h. place-hours.ts says "must be
  server-side, never browser" citing a tz-offset bug, but it already uses
  Intl.DateTimeFormat, which works identically client-side -- proposed
  porting to a ShareButton.astro-style inline <script>. Same bug also in
  facilities/index.astro + TodayBlock.astro (not yet proposed). (3)
  briggs-library + dakota-nature-park pages ALREADY EXIST; briggs-library
  has no hours data; Larson Nature Center (named in the park's own
  description, real address 1705 32nd Street S) has no page of its own --
  dry-run hours researched, library hours need final confirmation (one
  web search wrongly matched San Diego State, caught before reporting).

OPEN (carried): Candidate #42 (Line F Detention Basin, queue id=42).
NEXT: owner decides A and B; push d558596+17c7ca2 after separate yes.
