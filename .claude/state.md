# State

2026-10-14, Phase 8 ("Month in <Town>") BUILD -- all 8 owner conditions
  implemented, then a wording/dedup revision round after owner reviewed
  the first September preview (commit cb2a9d1). NOT PUSHED -- awaiting
  explicit push approval after this round's September preview.

DONE (3 commits, all local only): 136f34a (data layer), 1bf4bf9 (pages/
  routing/clusters/sitemap gate), cb2a9d1 (wording pass: every sentence
  now names our coverage/source as the actor, not the city; jobs dedup by
  title+company with a 15% significance threshold; fixed "See all
  months" link to actually point at /month/, not city-hall; "compiled
  from public data sources" replaces "no AI narration"; fixed a real bug
  found while re-verifying -- the Sept digest link pointed at a
  generated_by='data_pending' placeholder promising "what sold" when the
  body says data hasn't arrived).

VERIFIED (re-run after the wording round): full vitest 1012/1012, astro
  check 0 errors, real SITE_CITY=moreno_valley_ca build x3 (once per
  revision), scripts/verify_sitemap_noindex_disjoint.mjs green each time
  (142 urls). Extracted and read the ACTUAL built HTML text for Aug+Sep
  (not just the preview script) to catch the data_pending digest-link
  bug -- the preview script alone wouldn't have caught it since it only
  exercises the lib functions, not the page's own digestExists logic.
  Did not re-run Brookings/Broomfield builds for this wording-only round
  (astro.config.mjs untouched this round; only lib/page text changed,
  and those two towns only ever produce the /month/ redirect stub).

OPEN ITEM FOR LATER (owner: "note in state.md, bygg inte nu"): richer
  per-module detail without AI -- top-3 employers (jobs), most-affected
  roads (traffic), most-used event venues (events). Not scoped or
  started. Would need its own small design pass (e.g. does "top-3
  employers" count raw or post-dedup postings; does "most-affected
  roads" need the same in_town/approach split jobs/events already use)
  before touching code -- flag for a future session, do not build
  speculatively.

KNOWN BUGS: none new (the data_pending digest-link bug above was caught
  and fixed before this commit, not left open).

NEXT: owner reviews this round's September page (shown in chat, cross-
  checked against real built HTML). On explicit approval: `git push`.
  Until then: no push.
