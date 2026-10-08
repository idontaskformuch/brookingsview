# State

Current spec: .claude/phase2-spec.md. Step A + Phase 2 items 2d and 2a
done (see git log for exact commits). Next: 2b (homepage weekend module).

## Known residuals (owner aware, logged not dropped)
3 rows template_fallback; "must" opinion-marker FP risk (36 rejections);
44 brookings_sd pre_publish_check rejections since 10-02 unroot-caused; 11
duplicate-title groups w/o canonical series row; ICS venue-name-dropping
accepted; local stash "superseded-broomfield-draft" owner's to drop.
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Phase 2, item 2d -- DONE, config wired, NOT scraped live yet
configs/broomfield_co.json's data_sources.events: webtrac/compass kept as
documented `kind:"blocked"` dead ends, "chamber" (BizWest, owner-approved
despite caveats) is the one live 'ical' source. NOT yet run through
scrapers.runner against the live DB (needs owner go-ahead, rule 7; this
config's first-ever live run). Full detail in commit 561c295.

## Phase 2, item 2a -- DONE, committed, not pushed
/events restructured per phase2-spec.md: "This weekend in <Town>" hero
(Fri/Sat/Sun counts + cards), new "Nearby" section, existing Today/Coming
up/Further out now in-town-only. New shared lib/town-boundary.ts
(point-in-polygon vs real Census place-boundary GeoJSON per town, fetched
live from TIGERweb 2026-10-08 -- see its own module doc; static data at
src/data/town-boundaries/*.json) + haversine distance, explicitly
reusable later for Traffic/Jobs per spec. Owner decision (asked):
distance shown as "N mi away," never a drive-time estimate -- straight-
line, zero new API cost, matches /whats-on/'s existing precedent.
New "Outdoor" filter chip/facet (park-category venues only, same
grounding discipline as Free/Library). New required `SiteConfig.
townCenter` field (real values, matches existing `ticketmaster.lat/lon`).
astro.config.mjs's thin-facet sitemap mirror extended for 'outdoor'.
Verified real, not just unit-tested: 3 isolated --outDir builds (105/
133/77 sitemap URLs, exactly matching the pre-existing baseline --
no regression), sitemap/noindex-disjoint clean on all three, full
vitest (876 passed) + full pytest (726 passed/8 skipped) + astro check
(0 errors). Real data confirmed live in the Brookings build: weekend
hero showed Fri 4/Sat 3/Sun 4. No "Nearby" content yet on any town
(expected -- the one cross-town source, Broomfield's BizWest chamber
feed, isn't in the live DB yet, see 2d above).

## Next
Get owner approval to run the Broomfield chamber scrape live once
(2d's own next step). Then 2b (homepage weekend module) per
phase2-spec.md.
