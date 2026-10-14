# State

2026-10-14, Phase 8 ("Month in <Town>") BUILD -- owner approved building
  for moreno_valley_ca with 8 conditions (see command-args in this
  session's /clear). Building now; not pushed yet (condition 8).

DONE: data layer (commit 136f34a). db.ts: 6 new query siblings (decisions/
  projects/sales/events/traffic/jobs, each a "month" query + a "first-ever"
  floor query). lib/month-in-review.ts: coverage rule (condition 1) --
  floor<monthStart='full', floor in month='partial' (+"data from <date>"
  disclosure), else 'none'/omit; sales is the ONE exception (no floor
  rule -- count>0='full', count=0='none', see its own comment) because
  county data can have mid-timeline gaps a floor date can't see. Traffic
  reuses classifyTrafficIncident (condition 2, same corridors as
  traffic.astro) counted by created_at=first-seen (condition 2's dedup).
  Jobs counted by created_at=first-scrape (condition 4). Events use
  getContentByType (already excludes superseded_by_slug, condition 3) +
  existing classifyEventLocality. >=4-of-6 gate (condition 7) =
  clearedModuleCount(). Verified live: Aug AND Sep 2026 both clear 4/6
  (projects+events+traffic+jobs; decisions=0 rows ever for MV -- Legistar-
  only table, MV's council is eSCRIBE; sales=0 both months, county lag,
  most recent recorded sale is 2025-10-30) -- matches research file.

DECISIONS/SKÄL: MONTH_IN_REVIEW_START hardcoded per-town (moreno_valley_ca:
  2026-08) rather than "earliest month any module has data" -- avoids a
  2.5-year tail of near-empty noindexed pages back to property_sales' Jan
  2024 floor. Cluster registration will be 'month'+'month/detail' as
  PRIMARY spoke of civic ONLY (no secondary memberships) -- the research
  file's own "primary civic + secondary of 3 clusters" plan violates
  validateClusterConfig()'s real "max 2 total memberships" rule (verified
  by reading lib/clusters.ts); cross-links to home-sales/traffic/jobs/
  events will be plain teaser links instead, like the research file's own
  "teaser" bullets, not ClusterNav/SPOKE_NAV_COPY entries.

KNOWN BUGS: none new.

NEXT: build site/src/pages/month/[slug].astro + index.astro (condition 5:
  /month/<yyyy-mm>/ + /month/ hub, "<Town> in <Month Year>"), clusters.ts
  + BaseLayout nav (condition 5 linking), teaser links on city-hall/
  archive, home-sales/archive, traffic, jobs, events/past (condition 5),
  astro.config.mjs sitemap noindex mirror (condition 7), THEN run full
  vitest+astro check+build x3 towns+sitemap-disjoint script (phase-commit
  gate per CLAUDE.md), THEN show September page plain text to owner
  (condition 8) and WAIT for push approval.
