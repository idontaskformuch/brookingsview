# State

2026-10-14, Phase 8 ("Month in <Town>") BUILD -- all 8 owner conditions
  implemented and verified for moreno_valley_ca. NOT PUSHED (condition 8
  -- awaiting owner approval after seeing the September page, shown in
  this session's reply).

DONE (2 commits, both local only): 136f34a (data layer: 6 module
  fetchers + coverage rule in lib/month-in-review.ts + db.ts siblings) and
  1bf4bf9 (pages, clusters.ts/BaseLayout wiring, astro.config.mjs noindex
  mirror, 5 teaser links). Full detail in those commits' own messages.

VERIFIED (phase-commit gate, CLAUDE.md rule 3): full vitest 1012/1012,
  astro check 0 errors, real SITE_CITY builds for all three towns (MV
  3396 pages/1152s, Brookings 636 pages/319s, Broomfield 1074 pages/266s),
  scripts/verify_sitemap_noindex_disjoint.mjs green on all three dist/
  (MV 142 urls, Brookings 106, Broomfield 78) -- confirmed Brookings/
  Broomfield each produce ONLY a /month/ redirect stub (meta-refresh to
  /), correctly excluded from their own sitemap via the new
  TOWN_GATED_PAGES entry (this needed discovering live, not assumed --
  Astro's Astro.redirect() still emits a static stub file even for a
  "page doesn't apply to this town" branch). MV's /month/2026-08/ and
  /month/2026-09/ both confirmed indexable (no noindex meta, both present
  in sitemap-0.xml) -- matches the >=4-of-6 gate.

DECISIONS/SKÄL (for future reference, git log has full detail too):
  MONTH_IN_REVIEW_START hardcoded 2026-08 for moreno_valley_ca (avoids a
  2.5-year noindexed tail back to property_sales' Jan 2024 floor).
  'month'/'month/detail' are PRIMARY spokes of civic ONLY, no secondary
  memberships (research file's "secondary of 3 clusters" plan violates
  validateClusterConfig()'s real max-2 rule) -- cross-links are plain
  teaser <a> tags instead. Sales module uses its own count>0 rule, not
  the floor-date coverage rule the other 5 modules share (county data can
  have mid-timeline gaps a floor date can't see) -- see buildSalesModule()
  's own comment.

KNOWN BUGS: none new.

NEXT: owner reviews the September page's plain-text numbers+sentences
  (printed in this session's chat, via scripts/preview-month-in-review.ts
  2026-09, cross-checked against the real built HTML's <meta robots> and
  sitemap presence). On explicit approval: `git push`. Until then: no
  push, no further owner-facing changes needed -- feature is complete.
