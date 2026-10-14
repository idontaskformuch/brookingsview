# State

2026-10-14, Phase 8 ("Month in <Town>") BUILD -- owner approved building
  for moreno_valley_ca with 8 conditions (see command-args in this
  session's /clear). Building now; not pushed yet (condition 8).

DONE: data layer (commit 136f34a, see prior state.md entry for detail).
  Pages + wiring (uncommitted, in progress): site/src/pages/month/
  [slug].astro + index.astro (condition 5: /month/<yyyy-mm>/, /month/ hub,
  "<Town> in <Month Year>"); config/clusters.ts ('month'+'month/detail' as
  PRIMARY spokes of civic only, townId==moreno_valley_ca gate, SPOKE_NAV_
  COPY entry) -- validateClusterConfig() still passes (27 tests green);
  BaseLayout.astro nav+footer City group gets /month/ (isMorenoValley-
  gated); astro.config.mjs: TOWN_GATED_PAGES entry for /month/, PLUS a new
  noindex mirror in buildLastmodMap (condition 7's >=4-of-6 gate, mirrors
  lib/month-in-review.ts's coverageFromFloor() rule using 5 one-shot
  floor-date queries + 1 per-month sales count -- no classification
  needed since the gate only needs status, not exact counts); teaser
  links (plain <a>, not cluster spokes) added to city-hall/archive,
  home-sales/archive, traffic, jobs, events/past.

VERIFIED SO FAR: full vitest (1012 tests, all green), astro check (0
  errors after fixing a monthLabel naming collision with events/past.
  astro's own local helper of the same name -- aliased the import to
  monthInReviewLabel there). `npm run build` (SITE_CITY=moreno_valley_ca)
  kicked off, running long in background -- check its result before
  continuing (then build brookings_sd + broomfield_co too, then run
  scripts/verify_sitemap_noindex_disjoint.mjs against the MV dist/).

DECISIONS/SKÄL: see prior entry (git log) for MONTH_IN_REVIEW_START /
  cluster-membership reasoning -- unchanged.

KNOWN BUGS: none new.

NEXT: once all 3 builds + sitemap-disjoint check are green, commit this
  whole chunk (pages+clusters+nav+sitemap-mirror+teasers), then run
  scripts/preview-month-in-review.ts for 2026-09 again (data layer
  already verified live) and show the September page's actual rendered
  HTML/plain text to the owner per condition 8 -- THEN STOP. Do not push
  (git push) until the owner explicitly approves after seeing that output.
