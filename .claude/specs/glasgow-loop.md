# Handoff: UK country layer + Glasgow (glasgowloop.co.uk) -- pasted by owner 2026-10-21

Owner working rules for this spec: do NOT commit until the owner says go (overrides "commit locally per step" for this work).
No references to the owner's employer anywhere (code, comments, commits, docs).
Order set by owner 2026-10-21: weekend 24-25 Oct = Glasgow: Phase 0 (report), Phase 1 (country profile, US towns byte-identical),
Phase 2 (skeleton), then the fastest sources: Ticketmaster GB, Adzuna gb, Met Office (when the owner has the key), council meetings.
Goal: scrapers running and data collecting from day one; noindex OFF when the first real data flows.

## Context
Same master repo, config-driven multi-town. Glasgow is the first non-US town and establishes the UK template (London next, per-borough
paths later). Scotland and England differ in sources and law, so the profile is country (GB) + nation (scotland | england).

## Phase 0 -- US-assumption audit (report only, no changes)
Grep and list every US assumption: hardcoded America/* timezones, $/°F/US date formats, "zip", NWS-specific code paths, US state names in
guardrails (town_guard, SDSU opponent-state rule), US holidays in the this-week image rotation, US legal wording on /privacy /cookies /about,
American spelling in prompts. Output docs/uk-audit.md and stop for review.

## Phase 1 -- Country/nation profile layer
- config/countries/{us,gb}.* : locale (en-GB), currency (GBP), temperature (C), distance (miles), date format ("21 October 2026"),
  timezone (Europe/London), holiday calendar (UK + Scotland: 2 Jan, Burns Night, Bonfire Night, St Andrew's Day, Hogmanay), legal-page variant
  (UK GDPR/PECR/ICO), consent requirement (CMP before any ad/analytics cookie).
- nation sub-profile (scotland | england) selects default source adapters (police data, planning, property).
- Validation gate: British-English spelling check for gb towns; extend town_guard blocklists to glasgow (derived from config).
- REQUIRED: all three US towns build byte-identical before/after.
- Test DST transitions for Europe/London (BST/GMT), given past timezone bugs.

## Phase 2 -- Glasgow town config + deploy skeleton
- town_id glasgow, site name "Glasgow Loop", domain glasgowloop.co.uk, own accent colors via Local Accent Identity, section-nav config,
  all features disabled by default.
- wrangler.jsonc: env.glasgow with name "glasgowloop"; deploy command passes --env glasgow; secrets via `wrangler secret put X --env glasgow`
  (dashboard secrets did NOT bind to named envs last time).
- Site-wide noindex flag ON until Phase 3 data flows; trust pages + /about with multi-site disclosure from day one.

## Phase 3 -- Source adapters (each behind enabled flag)
Verify reachability + robots/ToS BEFORE building each one. Report dead ends; never evade bot protection.
1. Meetings: onlineservices.glasgow.gov.uk/councillorsandcommittees (custom ASP list + agenda docs). Include Area Partnerships (tag by area)
   and the Licensing Board.
2. Weather + alerts: Met Office DataHub (site forecast) + Met Office warnings for the Glasgow region; SEPA flood warnings. Replace NWS-zone
   geo-matching.
3. Traffic: Traffic Scotland (DATEX II needs approved subscription; build adapter against docs, disabled until access) + road-closure notices
   from tellmescotland.gov.uk.
4. Events: Glasgow Life what's-on (incl. free-events filter -> Free Things To Do) + Ticketmaster Discovery (countryCode=GB, small radius; city
   already contains the major venues). Curate venue capacity tiers for Glasgow.
5. Sports: Sportmonks free plan (Scottish Premiership: Celtic, Rangers).
6. Jobs: Adzuna country=gb.
7. School closures: find Glasgow City Council closure source; report if none.
8. Food hygiene: FSA ratings API (Scotland uses FHIS Pass / Improvement Required, not 0-5 stars).

## Phase 4 -- UK-first features
- Planning Watch (/planning): weekly planning lists by Community Council area + map web app; area hub pages. Factual summaries only.
- Licensing Watch: new premises licence applications from Licensing Board agendas -> feeds New in Town (also Companies House + new FHIS entries).
- Ward Trends: Police Scotland Multi Member Ward crime data as a monthly data narrative. Neutral language; never "most dangerous" rankings.
- Neighbourhood hubs: one page per Area Partnership area aggregating meetings, planning, licensing, events.

## Phase 5 -- UK guardrails (validation gate)
- Scottish contempt of court: hold (never auto-publish) any item about arrests, charges, sheriff/high court proceedings, or named suspects.
- Existing defamation hedging applies to all employer/business claims.
- Workplace Watch, comments, and games stay OFF for Glasgow in v1.

## Acceptance
astro check 0 errors; pytest/vitest green; US towns byte-identical; zero glasgow<->US leakage in either direction; sitemap/noindex disjoint
check passes for glasgow.

## Manual steps for the owner (list at the end, don't block on them)
Cloudflare project + deploy hook, wrangler secrets --env glasgow, Email Routing -> shared Proton address, Search Console + Bing + IndexNow,
API keys: Sportmonks, Met Office DataHub, Companies House; Traffic Scotland DATEX II application.
