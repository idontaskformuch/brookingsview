# State

2026-10-15. Round 2 COMPLETE, all verified, awaiting owner's final "ja"
  to push. Local HEAD is 4 commits ahead of origin/main: 3e662d8 (#4
  ClusterNav), b8d9583 (#3 pipeline fix), 6b74f8e (state), f985be2 (#3
  backfill run). Round 1 (5 commits) already pushed earlier this session.

ROUND 2 RECAP:
  #4 (ClusterNav dead-track removal): DONE. recipes/editorials/columns ->
    () => false for every town, reviews untouched. Tests updated.

  #3 (cross-source event duplicates), PIPELINE FIX: DONE. ai_pipeline/
    publish.py's new cluster_event_duplicate_indices()/dedupe_cross_
    source_events(), wired into publish_table() before story generation.
    Clustering: title+day+venue COMPATIBILITY (not exact match) -- a row
    with no venue info merges into a cluster with one resolved named
    venue; two distinct named venues in one title+day bucket is a real
    conflict, never guessed at. Winner: resolved venue first, then has a
    description, then lowest id.

  #3 BACKFILL INVESTIGATION (this exchange): owner asked why the QA
    report's "45 Brookings / 10 Moreno Valley duplicate groups" didn't
    match the backfill's original 3-pair dry-run. Root cause found: the
    QA report counted duplicate RAW `events` rows (same real event
    re-scraped across runs/sources, among UPCOMING rows) -- a different,
    much larger population than duplicate PUBLISHED `stories`. Checked
    all 44 Brookings + 562 Moreno Valley raw-duplicate groups against
    `stories`: ZERO others have 2+ published, unsuperseded rows today --
    only one row per group has ever been published; the rest are pending
    raw rows the already-committed pipeline fix will prevent from ever
    becoming duplicate stories (no backfill needed for them). Confirms
    the original 3 pairs were already the true, complete backfill target
    -- nothing was being missed by the algorithm itself.
    SIDE FINDING (flagged, NOT fixed -- out of scope for #3): Moreno
    Valley's "MAIN LIBRARY: Family Fun" etc. duplicate groups are SAME-
    SOURCE (source='library') re-scrapes producing NEW rows under
    DIFFERENT content_hash for what looks like identical content -- a
    content_hash-instability bug, not cross-source duplication. Separate
    investigation needed if the owner wants this picked up later.

  #3 MANUAL OVERRIDE: event-282137 ("Free Community Art Day") added via
    a new, explicitly-labeled MANUAL_SUPERSEDE_OVERRIDES dict in
    scripts/merge_cross_source_event_duplicates.py (owner-reviewed: same
    occurs_at as event-305361, compatible/missing venue, title-matching
    algorithm's own documented exact-match limitation doesn't catch the
    "Free ..." wording difference -- a hand reviewed one-off, not a
    loosening of the general algorithm).

  #3 BACKFILL RUN: DONE, ran for real against production per owner
    approval. 4 rows marked superseded_by_slug (nothing deleted):
      event-282120 -> event-278302 (One Day for STATE)
      event-282123 -> event-278305 (They Were There: Witnesses from 9/11)
      event-282136 -> event-305361 (Community Art Day)
      event-282137 -> event-305361 (Community Art Day, manual override)
    event-series-redirects.json updated (1037 entries total, 4 new) --
    worker.ts already reads this file, no code change needed for the
    301s to take effect.

PRE-PUSH VERIFICATION (all green, this session, after the backfill run):
  - pytest: 870 passed, 8 skipped (unchanged from before backfill -- the
    backfill script itself IS tested, just doesn't add new pytest count
    since it ran as a one-off, not part of the suite).
  - vitest: 1033 passed, 51 files.
  - astro check: 0 errors, 0 warnings (pre-existing hints only).
  - astro build all 3 towns (fresh rebuild post-backfill): brookings_sd
    635 pages, moreno_valley_ca 3407 pages, broomfield_co 1078 pages --
    all exit 0.
  - scripts/verify_sitemap_noindex_disjoint.mjs: OK on all 3 (107/140/80
    sitemap URLs, all indexable+present, zero offenders). Temp dist-*
    dirs removed after checking.

NEXT STEP: push the 4 commits above after owner's explicit "ja".

REMAINING QA FINDINGS, not yet scheduled: #5 (duplicate <title> on
  recurring/multi-instance pages, all 3), #6 (Astro.redirect() -> 200 not
  301/302, all 3), #9 (Celebration Park hours, Moreno Valley, unverified/
  info-only). Also newly flagged (not a QA-report item, found this round):
  Moreno Valley library-source content_hash instability -- see above.
