# State

2026-10-14, Phase 8 ("Month in <Town>") BUILD -- complete and pushed (or
  about to be, this commit is the last before push). All 8 original
  owner conditions + two review rounds of feedback implemented.

COMMITS (chronological): 136f34a (data layer), 1bf4bf9 (pages/routing/
  clusters/sitemap gate), cb2a9d1 (wording pass + first jobs-dedup
  attempt w/ 15% threshold), 20ecc80 (state note), ceab00d (jobs dedup
  simplified: always distinct, no threshold, no before/after note; also
  investigated+reported on data_pending home-sales digests, no change
  needed there -- already correctly noindexed by pre-existing code).

FINAL STATE: jobs module always reports distinct (title+company) counts
  for both in-town and nearby, every month -- September reads "469
  distinct new job postings ... (plus 165 distinct nearby)." Every
  sentence names our coverage/source as the actor (siteName for
  decisions/projects/events, Adzuna for jobs, Caltrans QuickMap for
  traffic, the county assessor's report name for sales). Lede says
  "compiled from public data sources." "See all months" links straight
  to /month/.

VERIFIED (final pass): full vitest 1012/1012, astro check 0 errors, real
  SITE_CITY=moreno_valley_ca build + verify_sitemap_noindex_disjoint.mjs
  (142 urls, green), real built HTML text-checked for both module
  wording and the 11 data_pending home-sales-digest rows (confirmed: none
  in the sitemap, each carries noindex,follow on its own page).
  Brookings/Broomfield builds last re-run in the pages/routing commit
  (1bf4bf9) -- untouched by the two wording-only rounds since, so not
  re-run a 4th/5th time (astro.config.mjs's sitemap mirror wasn't
  touched in either wording round; those towns only ever produce the
  /month/ redirect stub regardless of lib/page wording).

OPEN ITEM FOR LATER (still not started, still just noted): richer
  per-module detail without AI -- top-3 employers (jobs), most-affected
  roads (traffic), most-used event venues (events). Needs its own design
  pass before any code.

KNOWN BUGS: none open.

NEXT: pushed this session per explicit owner approval ("pusha alla
  commits efter att du visat jobbmeningen"). If anything surfaces after
  push (real traffic to the new pages, a wording tweak request), pick up
  from here -- no outstanding local-only work.
