# State

2026-10-15. Pushed through acb94ed (origin/main up to date). Local HEAD is
  one commit ahead (this session's QA-report commit) -- not pushed yet,
  per "pusha aldrig utan godkännande."

DONE+LIVE (confirmed again this session): Briggs Library hours_text + Larson
  Nature Center both live and correct on brookingsview.com. All 3 towns'
  homepages show build-sha=acb94ed with CF-Cache-Status: HIT -- the purge/
  freshness-check fix from the prior session is confirmed working.

DONE: Full read-only QA audit, all 3 towns (sections A-H from the owner's
  brief). Report: .claude/qa-audit-2026-10.md. Three per-town deep-audit
  subagents were launched; only Brookings' finished (rate limit killed the
  other two mid-run) -- its draft was folded into the final report and
  deleted. Moreno Valley + Broomfield's A/B/D checks were done directly
  (DB queries + WebSearch/WebFetch against official sources) rather than
  re-spawning agents. No fixes, no DB writes, no pushes were made.

KEY FINDINGS (grouped by root cause, full detail + evidence in the report):
  1. KRITISK, all 3 towns: meeting stories/decisions are never revisited
     after the meeting happens -- outcomes stay "pending"/future-tense
     indefinitely (confirmed live on all 3, three different source systems:
     Legistar/AgendaLink/eSCRIBE). No post-meeting reconciliation job exists
     anywhere in the pipeline. This is the single most important finding.
  2. Hög, brookings_sd only: getWorthKnowingCandidates() in site/src/lib/
     db.ts lets occurs_at IS NULL rows bypass the recency floor -- 5 stale
     (3-3.5mo old) meeting stories permanently eligible for "Worth knowing".
  3. Hög, brookings_sd + moreno_valley_ca: no dedup before story generation
     from `events` -- confirmed live triple-render (Brookings "Community Art
     Day") + 45/10 exact-dup DB groups respectively. All dupe story pages
     are noindex, so reader-UX issue, not an SEO/indexing one.
  4. Medel-hög, all 3: ClusterNav's shared "Local life" spoke list
     (config/clusters.ts ROUTE_AVAILABILITY) hardcodes recipes/editorials/
     columns/(reviews) as `() => true` regardless of the Oct-7 content-track
     shutdown -- still funnels readers from indexable hub pages into now
     1-2+ week stale dead-end content on all 3 towns.
  5. Medel-hög, all 3 (worst on Moreno Valley): dozens of distinct pages
     (recurring event instances, multi-date meeting-notice templates,
     multi-showtime Ticketmaster listings) share identical <title> tags
     with no date/instance differentiator -- confirmed NOT a data dupe
     (different real dates/showtimes), just a title-generation gap.
  6. Medel, all 3: `Astro.redirect()` inside non-dynamic static pages
     (sports/jackrabbits/vail-resorts/university/home-sales/etc. on towns
     where that route doesn't apply) bakes to HTTP 200 + client-side meta-
     refresh instead of a real 301/302 -- confirmed on all 3 towns. A truly
     nonexistent URL still 404s correctly everywhere.
  7. Hög, brookings_sd only: /facilities/public-library/ and /facilities/
     city-hall/ both off by exactly 1 hour vs. official source; mccrory-
     gardens missing phone/hours despite being in its own cited source.
     Moreno Valley + Broomfield facility spot-checks (4 total) all matched
     official sources exactly -- looks isolated to Brookings, not systemic.
  8. Medel, brookings_sd: homepage renders the same quorum-notice story
     twice (Worth Knowing + Coming up rivers aren't cross-deduped).
  9. Låg/info, moreno_valley_ca: Celebration Park's posted hours look
     unusual for a city park; could not independently verify -- flagged
     for owner follow-up, not confirmed wrong.
  Cross-town leak check (section C): CLEAN. Everything the mechanical
  crawler initially flagged was the intentional sister-site cross-link
  network (footer links + JSON-LD sameAs) + the by-design Phase C cross-
  site canonical consolidation for shared AI content types (recipes/
  reviews/science-column) -- verified via source read, not a leak.
  Technical/SEO (section E): clean otherwise -- no real 404s, redirect
  loops, broken robots.txt/RSS/JSON-LD found on any of the 3 sites.

KNOWN LIMITATIONS (stated in the report, not hidden):
  - H (mobile 390px): NOT tested with real rendering -- Playwright chromium
    download timed out (no network path to cdn.playwright.dev from this
    environment). Static CSS skim found no obvious overflow risk, but this
    is explicitly not a substitute for a real viewport test.
  - Month-page recompute: only moreno_valley_ca has /month/[slug]/ at all
    (ROUTE_AVAILABILITY gates it to that town); its Sept 2026 numbers were
    read and looked plausible but were not independently re-derived from
    the DB within the session's time budget.
  - Moreno Valley + Broomfield's "20 events vs. source" and "10 decisions
    vs. source" checks are a smaller targeted sample, not the full sweep
    Brookings got (agent failure mid-run) -- no sign of systematic date/tz
    bugs in what WAS checked, but breadth is lower than Brookings' coverage.

NEXT STEPS: Report fixes in rounds per owner approval, kritisk first (item 1
  above). Nothing else open from prior sessions.
