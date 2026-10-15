# State

2026-10-15. QA audit follow-up, round 1 COMPLETE. Local HEAD is 5 commits
  ahead of origin/main -- NOT pushed, awaiting owner's final "ja".
  Commits: c66fa64 (facility data), 48eb708 (Broomfield wiring+interval
  bug), c6d3e17 (meeting banner), 4852cef (state), 1d5f934 (#2/#8 fixes).

DONE this round, all approved + built + verified:
  - H (mobile 390px): CLOSED -- owner manually confirmed no horizontal
    scroll on all 6 page types.
  - #2 (occurs_at IS NULL) + #8 (Worth Knowing/Coming up dup): fixed, with
    tests. See prior entry below for detail (unchanged this pass).
  - #1 (meeting outcomes banner): BUILT. New meetingOutcomesBanner() in
    site/src/lib/meeting-decisions.ts, wired into s/[slug].astro right
    after the date line. 3 variants per siteConfig.meetingDecisionsTracked
    (true for brookings_sd/broomfield_co, false for moreno_valley_ca) and
    whether partitionDecisions() found a decided item. Never rewrites the
    AI prose -- only adds a line above it, and only once the meeting's own
    calendar day has passed. Tests in meeting-decisions.test.ts.
  - #1 (Broomfield wiring): BUILT + RUN. ai_pipeline/meeting_decisions_
    agendalink.py added to broomfield-scrape.yml (after publish, before
    build, continue-on-error). find_candidate_meetings() rewritten: NOT
    EXISTS (meeting_decisions) over a 90-day window, checked every run,
    instead of a 60-day-minimum-then-try-once gate. Tests added.
    SEPARATE BUG FOUND+FIXED while building this: `interval '%s days'`
    puts the placeholder inside the quoted literal -- psycopg substitutes
    it textually (as `$1`) but Postgres then parses the literal STRING
    "$1 days", which its interval parser silently accepts as exactly 1
    day regardless of the bound value. Live-confirmed this ALSO broke the
    original 60-day gate the whole time. Fixed with `%s * interval '1
    day'` (placeholder outside any quotes). Ran manually against
    production per owner's request: 6 new decisions written, including
    all 6 for the Sep 23 meeting (id 11341) that motivated this fix --
    confirmed in DB.
  - #7 (facility data): WRITTEN + SEEDED. data/facilities/brookings_sd.json:
    public-library hours_text 9pm->8pm close; city-hall hours_text 7am->8am
    open (BOTH Mon-Thu and Friday -- the Friday error was NOT caught by
    the original QA pass, found only when re-verifying the full weekly
    schedule instead of patching just the flagged clause); library
    description's derived "66 hours a week" -> "62" (recomputed); McCrory
    Gardens phone (605-688-6707) + seasonal hours_text added (previously
    both NULL). Owner approved exact text before seed; python -m
    scripts.seed_facilities brookings_sd run against production, 17
    updated, 0 inserted. Confirmed live in `places` table.

PRE-PUSH VERIFICATION (all green, this session):
  - pytest: 850 passed, 8 skipped (pre-existing, unrelated).
  - vitest: 1031 passed, 51 files.
  - astro check: 0 errors, 0 warnings (pre-existing hints only).
  - astro build all 3 towns: brookings_sd 635 pages, moreno_valley_ca 3391
    pages, broomfield_co 1077 pages -- all exit 0.
  - scripts/verify_sitemap_noindex_disjoint.mjs: OK on all 3 (107/140/80
    sitemap URLs, all indexable+present, zero offenders). Temp dist-*
    dirs removed after checking.

NEXT STEP: push all 5 commits after owner's explicit "ja" (per CLAUDE.md
  rule 6/9 -- never push without approval, even though this round's work
  was approved).

REMAINING QA FINDINGS, not yet scheduled (round 2+): #3 (dedup at story-
  generation from events, Brookings+Moreno Valley), #4 (ClusterNav linking
  to dead content tracks, all 3), #5 (duplicate <title> on recurring/
  multi-instance pages, all 3), #6 (Astro.redirect() -> 200 not 301/302,
  all 3), #9 (Celebration Park hours, Moreno Valley, unverified/info-only).
