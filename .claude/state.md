# State

2026-10-15. Round 1 PUSHED (f7d0da5..origin/main). Round 2 in progress:
  #4 done+committed, #3 pipeline fix done+committed, #3 backfill dry-run
  shown below -- AWAITING OWNER APPROVAL to run for real. Local HEAD is
  3 commits ahead of origin/main (3e662d8, b8d9583, and this state commit)
  -- not pushed yet.

ITEM 2 (interval-bug repo audit): DONE, no further action needed. Searched
  all .py/.ts/.mjs/.sql for `interval '<placeholder>'` (placeholder inside
  the quoted literal, in any unit -- days/hours/etc, psycopg %s, named
  %(x)s, or $N). Exactly ONE real hit existed anywhere in the repo: the
  one in ai_pipeline/meeting_decisions_agendalink.py already found+fixed
  last round. Confirmed clean: Legistar's "60 days" (legistar_v1.py) is
  pure Python timedelta, never touches SQL -- not affected.
  project_updates.py/project_updates_legistar.py have no interval usage
  at all. Every other `interval '...'` in the codebase (db.ts, worker
  server files, astro.config.mjs, closure_watch_digest.py, eval_tone_v2.py,
  vail_news_v1.py, regenerate_stale_event_bodies.py) uses a fixed literal
  number baked into the string, never a parameter -- safe by construction.

ROUND 2:
  #4 (ClusterNav dead-track removal): DONE, committed (3e662d8), tests
    added/updated. recipes/editorials/columns -> () => false for every
    town in site/src/config/clusters.ts ROUTE_AVAILABILITY (same value
    everywhere, not per-town -- the track is dead sitewide). reviews
    untouched (not part of this finding). Full vitest suite green (1033).

  #3 (cross-source event duplicates), PIPELINE FIX: DONE, committed
    (b8d9583), tests added. ai_pipeline/publish.py: new
    cluster_event_duplicate_indices() (shared primitive) + dedupe_cross_
    source_events(), wired into publish_table() after group_event_slots/
    group_recurring_events, before story generation. Key design point
    found testing against production: clustering is title+day+venue
    COMPATIBILITY, not exact venue match -- a row with NO venue info
    (e.g. the GrowthZone mirror never captured one) still merges with a
    cluster member that resolves to a real facility; two DIFFERENT named
    venues sharing a title+day is a real conflict, never guessed at.
    Winner picks: resolved venue first, then has a description, then
    lowest id. Known, accepted limitation: exact-title match only (the
    live case's "Free Community Art Day" vs "Community Art Day" near-miss
    is not caught -- fuzzy matching risks worse false merges).

  #3 (cross-source event duplicates), BACKFILL: scripts/merge_cross_
    source_event_duplicates.py written, committed, NOT YET RUN for real.
    Reuses the exact same cluster_event_duplicate_indices() so it can't
    drift from the pipeline fix. Writes into the SAME site/server/event-
    series-redirects.json the existing merge_recurring_event_duplicates.py
    uses (worker.ts already 301s from that file at the edge -- no
    worker.ts change needed).
    DRY-RUN RESULT (production, 2026-10-15), shown to owner, awaiting
    "ja" to run for real:
      brookings_sd: 'One Day for STATE' (2026-09-09) -> keep event-278302,
        supersede event-282120
      brookings_sd: 'They Were There: Witnesses from September 11th'
        (2026-09-11) -> keep event-278305, supersede event-282123
      brookings_sd: 'Community Art Day' (2026-10-17) -> keep event-305361,
        supersede event-282136
    event-282137 ("Free Community Art Day") stays untouched -- the known,
    accepted near-miss-title limitation, not a bug.

PRE-PUSH VERIFICATION this round: pytest 870 passed/8 skipped (was 850
  before round 2 -- +20 new). vitest 1033 passed (was 1031). Full 3-town
  build/sitemap-check NOT yet re-run since round 1's -- due before next
  push per CLAUDE.md rule 3.

NEXT STEPS:
  1. Owner approves/declines the backfill dry-run above -- on approval,
     run `python -m scripts.merge_cross_source_event_duplicates` for real.
  2. Full pre-push battery (pytest+vitest already green above; still need
     astro check + 3-town build + sitemap/noindex-disjoint check before
     the next push, per CLAUDE.md rule 3).
  3. Push after owner's explicit "ja" (3 local commits + whatever the
     backfill run adds).

REMAINING QA FINDINGS, not yet scheduled: #5 (duplicate <title> on
  recurring/multi-instance pages, all 3), #6 (Astro.redirect() -> 200 not
  301/302, all 3), #9 (Celebration Park hours, Moreno Valley,
  unverified/info-only).
