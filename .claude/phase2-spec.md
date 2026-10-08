# Phase 2 spec — weekend front door

Goal: Mediavine Journey (1,000 sessions/30 days, GA-verified, original audience-first content). Strategy: no generic AI content, correct data, Events as front door. Sites are young (2-3 months); the owner wants real value, not SEO tricks.

Context: Brookings /events gets ~40 of ~60 monthly visits, from Bing/DuckDuckGo. Moreno Valley gets traffic from Facebook and Bing. Broomfield's Google data shows demand for facility/venue and civic-reference queries (parks, community center, library, recycling, park and ride, non-emergency police), mostly position 6-13 with 0% CTR. Google data does not cover Bing/Yahoo/DDG, so do not conclude low demand for Brookings or Moreno Valley.

Tasks, in order, each shippable alone; one commit per task:

2d. Broomfield event source (first). Investigate public, robots-compliant sources (city calendar, library calendar, recreation calendar). If one is clean, wire it through the config-driven source registry. If none, write a short findings note and move on. Never evade blocks. Zero events is better than wrong events. Report findings before building.

2a. /events structure (all towns with event sources). Top: "This weekend in <Town>" split Fri/Sat/Sun with counts. Then "In <Town>" and "Nearby" (with drive time). Then existing Today/Coming up/Further out buckets. Filter chips: Free, Kids, Library, Outdoor. Filtered URLs: noindex and out of every sitemap, verified on all three towns. "In town" = point-in-polygon against a static Census place-boundary GeoJSON per town; fallback: venue address city; Nearby default 25 mi. Build the boundary helper as a shared utility (reused later for Traffic and Jobs).

2b. Homepage module. Compact "This weekend": counts per day, 3-5 top in-town events, link to /events. Place high, in the slot freed by Phase 0. Hide when no events.

2c. Search signals. ItemList JSON-LD on /events, accurate dateModified. Title/H1: plain "Events in <Town>" with a per-town config hook; tuning against Bing query data comes later as a separate small change. IndexNow/Crawler Hints: the owner checks in Cloudflare.

2f. Facility SERP pass (all towns, cheap). Title pattern "<Facility name> — Hours, Address & Phone | <Town>" (only elements that exist). Above the fold on every facility page: address, phone, hours (where structured), map link, source link. Place/LocalBusiness-style JSON-LD only with real data. Check the facility registry against these searched names and report which have no page; DO NOT mass-create pages (add only if it exists in official source data and was searched; otherwise give the owner a list). Broomfield: Quail Creek Park, community center / Paul Derda Rec Center, Columbine Meadows Park, park and ride, public library (Mamie Doud Eisenhower), recycling center, Lac Amora, Northmoor, Bronco, Greenway, Broadlands and Broadlands West, Midway parks, municipal court, Depot Museum, Bay Aquatics, health and human services, non-emergency police line, 280 Spader Way. Moreno Valley: City Hall (incl. 14075 Frederick St), Conference & Recreation Center. Brookings: SDSU athletics, county jobs.

Also: write a 5-line proposal in state.md for indexable series pages for named annual events (Brookings Arts Festival, Arts in the Park) with an explicit bar (e.g. >=3 occurrences or a year of history, real source data, no AI filler). Do not implement; owner decides.

Done when: weekend structure renders on all towns with event sources; in-town/nearby manually checked on 20 events per town; facet URLs out of every sitemap; homepage module renders; facility pages show address/phone/hours with the new title pattern; facility gap list reported. Full verification once (full tests, astro check, all three builds sequentially in isolated outDirs, sitemap/noindex-disjoint check), then commit. After Phase 2: stop and report (what shipped, sitemap counts before/after, gap list, named-event proposal, blockers). Phase 3 starts after owner approval.
