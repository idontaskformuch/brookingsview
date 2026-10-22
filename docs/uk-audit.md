# UK / Glasgow -- US-assumption audit (Phase 0, report only)

Date: 2026-10-22. Spec: .claude/specs/glasgow-loop.md. Nothing in the repo was changed except this file.
Method: targeted greps over source (tests, backups, reports, node_modules, dist excluded unless noted). "Not verified" marks things inferred but not opened.

## Summary
The multi-town layer is config-driven for identity (town_id, state, county, coordinates, timezone) but has NO country concept.
US assumptions sit in five places: (1) formatting hardcoded to `en-US` in ~32 site files, (2) weather/alerts wired to NWS,
(3) guardrails keyed on US state names, (4) legal/consent copy written for US law, (5) seasonal/holiday content tied to US holidays.
Phase 1 must introduce `country` (+ `nation`) and thread it through these; the ranked table at the end shows the work.

## 1. Time zones
- Per-town `timezone` already exists in configs/*.json and site-config.ts. Europe/London is a drop-in value.
- Hardcoded US FALLBACKS in Python (used when cfg has no timezone): validation/date_coherence.py:68 (America/Chicago),
  ai_pipeline/publish.py:857, whats_on_intro.py:532, sdsu_weekly_digest.py:362, weekly.py:248/280/367 (all Chicago),
  workplace_watch_digest.py:317 (Los_Angeles). Harmless while cfg always sets timezone; silently wrong if a gb config omits it. Fix: fail loudly or derive from country.
- cron-dispatcher/src/schedule.ts:27-28 maps the closure-watch workflows to America/Chicago and America/Los_Angeles (local 05:30 filter). Glasgow needs its own entry (Europe/London) when it gets a closure-watch.
- election-results/src/towns.ts holds per-town zones (US elections only; not relevant to Glasgow).
- DST: Europe/London changes on the last Sunday of March/October; the US on 2nd Sunday of March / 1st Sunday of November. For about 2-3 weeks a year the offset between the two differs from normal. Phase 1 DST test per spec. I did not audit every conversion for named-zone use.
- Browser side: BaseLayout sets `data-timezone={siteConfig.timezone}` -- fine.

## 2. Locale, dates, numbers, currency
- `toLocaleDateString/TimeString/Intl.DateTimeFormat('en-US', ...)` hardcoded in ~32 files, e.g. lib/time.ts (34, 66, 70, 149), lib/this-week.ts:69,
  components/TopEventCard, TodayBlock, WhatsOnCard, WorkerPulseComments, pages/closures.astro, weather.astro:70, whats-on/[slug].astro, s/[slug].astro,
  this-week/[week].astro, qa/web/checks.mjs, cron-dispatcher/src/schedule.ts. Output is month-first ("Oct 21"); UK wants "21 October 2026".
- 12-hour clock built by hand in lib/time.ts:61-62 ("7pm", "7:30pm") and with AM/PM + space at time.ts:150. UK convention differs for meetings/transport (24h).
- `<html lang="en">` and `og:locale = en_US` hardcoded in layouts/BaseLayout.astro:126,150 -> en-GB / en_GB.
- JSON-LD: addressCountry 'US' hardcoded in lib/article-jsonld.ts:214,328; lib/event-jsonld.ts:79; lib/ticketmaster-jsonld.ts:43; pages/facilities/[slug].astro:348.
  priceCurrency defaults to 'USD' in ticketmaster-jsonld.ts:54. addressRegion uses stateAbbr (Glasgow has no state).
- Dollar formatting: farm-report.astro, home-sales, closures, ticketmaster.ts, sign-game.ts and AI prompts (format_prompt.py, whats_on_intro.py). Farm report (USDA) and home sales (Riverside County) are US-only data and stay disabled for Glasgow.
- Temperature/wind: NWS payload carries `temperatureUnit` ("F") and wind as text ("10 mph"), shown as-is (weather.astro, db.ts WeatherPeriod/HourlyPeriod). No C conversion exists. HeatAdvisoryWidget is F-based, Moreno only (flag hasHeatAdvisory).
- Distance: Ticketmaster adapter always uses `unit=miles` (lib/ticketmaster.ts:362). Miles is correct for the UK.

## 3. Weather, alerts, traffic (US government feeds)
- scrapers/parsers/noaa.py (api.weather.gov forecast + hourly) and nws_alerts.py (alerts?zone=<NWS zone>) are the only weather paths.
  configs/*.json `weather_alerts.area` is an NWS zone code. Neither works outside the US. Met Office DataHub / warnings / SEPA need new adapters (spec Phase 3.2).
- site/src/lib/alerts.ts, cityStatus.ts, db.ts, pages/weather.astro, closures.astro consume rows keyed `source = 'nws_alert' | 'county_alert'` and NWS category strings ("Hazardous Weather Alerts"). A new source must map into the same row shape or get a source-agnostic path.
- Traffic: sd511.py (SD), cdot_v1.py (Colorado), traffic_v1.py are state DOT feeds; Glasgow = Traffic Scotland / tellmescotland (Phase 3.3).
- Property sales: rivco_property_sales_v1.py (Riverside County) / `home_sales` are US county records. USDA (usda.py) farm report is US only.

## 4. Events, sports, jobs, meetings
- Ticketmaster: Discovery supports countryCode=GB; the adapter searches by latlong+radius, but exposes `venueStateCode` (lib/ticketmaster.ts:284), which will be empty or irrelevant for GB venues. Any code that treats it as required is not verified.
- Jobs: jobs_v1.py already reads `source_cfg.country` (default "us"), so Adzuna gb works by config. Category classification and wage text ($/yr) may be US-flavoured -- not verified.
- Sports: gojacks_v1.py (SDSU), regional_sports_v1.py and the jackrabbits/football/basketball digests are US-college oriented. Glasgow = Scottish football via Sportmonks.
- Meeting parsers (Legistar, AgendaLink, eSCRIBE, SmartGov, CivicEngage) are US vendor platforms; Glasgow needs a new parser for its custom ASP list (Phase 3.1).
- Civic vocabulary ("city council", "county commission", "zoning") appears in prompts and pages. Scotland: council, Community Council, Area Partnership, Licensing Board. Not enumerated line by line.

## 5. Guardrails and validation (US state model)
- ai_pipeline/town_guard.py: STATE_NAMES = {SD, CA, CO} only (~line 51). The identity blocklist itself IS config-derived (display_name, county, identity.terms), so Glasgow gets two-way cross-blocking automatically once its config exists, provided `county` is set sensibly (Scotland has no county: "Glasgow City" council area).
- content/_base.py:97 town_label() builds "Town, State" for every prompt; Glasgow would need "Glasgow, Scotland" (nation, not state) -- today an unknown state falls back to a vague string.
- validation/place_state.py models all 50 US states and flags a wrong-state mention unless grounded in the source. For a gb town it would be a no-op or give false positives on names like Washington/Georgia/Indiana; needs a country-aware path.
- The "SDSU opponent-state rule" is not a separate module; it is the source-grounding exception documented in town_guard.py / place_state.py.
- validation/election_business_policy.py and date_coherence.py are US-context (Chicago fallback, see 1). Not reviewed further.
- The Scottish contempt-of-court hold (Phase 5) has no precursor in the code; must be new.

## 6. Spelling and copy
- site/src/lib/american-spelling.test.ts FAILS on British spellings (organis*, colour*, neighbour*, centre* ...) in any site/src .astro/.ts file (comment lines skipped). It would block British copy for Glasgow wherever templates are shared: must become country-aware, plus an inverse check for gb.
- AI prompts: no explicit "American English" instruction found by grep in ai_pipeline/content/guardrails/validation, so output spelling is implicit; gb generation needs an explicit en-GB instruction.
- about.astro names each US state/town in its multi-site paragraph (lines 24, 36, 50); a Glasgow entry and the data-qa-allow-sibling-sites exception must be added.
- Address model: `postal_code` columns and "ZIP code" wording (home_sales_digest.py, venue_registry.py, facility seeding). UK postcodes (e.g. G1 1XQ) will not match ZIP regexes in venue_registry.

## 7. Holidays and seasonal content
- site/src/config/holidays.ts is the US set: Halloween, Thanksgiving (4th Thu Nov), Christmas, Memorial Day, July 4th, Labor Day, Veterans Day (the last four inactive), plus Valentine's/New Year's. Photo entries carry `town_ids`.
- UK/Scotland set per spec: 2 Jan, Burns Night (25 Jan), Bonfire Night (5 Nov), St Andrew's Day (30 Nov), Hogmanay; no Thanksgiving/July 4/Labor/Memorial/Veterans. The fixed / nth_weekday rules cover these; Easter (if wanted) needs a computus rule.
- This-week image rotation and category images carry place strings in alt text per entry (e.g. "in Brookings, South Dakota"); Glasgow starts with an empty pool. The one-town-per-photo rule applies unchanged.

## 8. Legal, consent, ads, analytics
- privacy.astro, cookies.astro, terms.astro, advertising.astro are written around AdSense + Google Analytics and "opt out of personalized ads" (US-style opt-out). UK needs UK GDPR/PECR/ICO wording: controller identity, lawful basis, cookie list with opt-IN, ICO complaint route. No CCPA/"Do Not Sell" text found by grep; full read not done.
- Consent: BaseLayout gates analytics/ads on `window.bvConsent === 'accepted'` (localStorage 'bv_cookie_consent', CookieBanner.astro) -- already opt-in, a good base. PECR gaps not verified: per-category choice, reject parity, banner copy.
- ads.txt is served per town (pages/ads.txt.ts, Moreno only); Glasgow has no AdSense account and must stay without it.
- Owner decisions already in state.md: consent v1 = own opt-in banner, GA4 only after owner yes, no ads, Google CMP when AdSense becomes relevant.

## 9. Infra / build
- site-config.ts is the single typed source; stateName/stateAbbr are REQUIRED fields. Smallest change: add `country`/`nation`, make state fields optional (or `region`). Every consumer of stateName/stateAbbr (about, JSON-LD, town_label, sign copy) must be checked -- consumer count not produced.
- configs/*.json (Python) and site-config.ts (TS) are hand-synced (tests/test_feature_flags etc.).
- site/wrangler.jsonc is a single worker; Glasgow needs env.glasgow (Phase 2). Deploy workflows exist per town; a fourth is needed.
- Sitemap/noindex gating lives in astro.config.mjs and must treat glasgow as a fourth town in the disjointness check.
- cron-dispatcher: scrape workflows per town; glasgow-scrape comes in Phase 3, not Phase 1.
- election-results and /vote are US-only; Glasgow must have neither.

## 10. Phase 1 work ranked by risk to US byte-identity
| # | Change | Risk to US byte-identity |
|---|---|---|
| 1 | Add `country`/`nation` to site-config + configs JSON; us profile reproduces current behaviour exactly | none if defaults match |
| 2 | Route all 'en-US' formatting through a profile locale (lib/time.ts first, then ~30 files) | medium: a missed call differs; verify with before/after dist diff |
| 3 | `<html lang>`, og:locale, JSON-LD addressCountry/currency from profile | low (same strings for us) |
| 4 | american-spelling test country-aware; add UK spelling check | low (test-only) |
| 5 | town_guard STATE_NAMES / town_label / place_state nation path; fail loudly on missing timezone | low |
| 6 | Holiday calendar per country | low if the us set is unchanged |
| 7 | Legal page variants selected by country | low for us (render branch only) |
| 8 | Temperature unit / weather source abstraction | defer to Phase 3 |

## 11. Questions for the owner (none block Phase 1 start)
1. Glasgow has no state/county: OK to make stateName/stateAbbr optional and use a `region` ("Scotland") instead of faking values?
2. Time format for gb: "7pm" everywhere, or 24-hour for meetings/transport?
3. Spelling gate for gb: block American spellings in static copy, or only warn?
4. Legal pages: separate files per country (keeps US output trivially byte-identical) or one template with a country branch?

## Not covered
Full read of privacy/cookies/terms copy and CookieBanner; every prompt file line by line; SQL migrations for US-specific columns; every consumer of stateName/stateAbbr; tests that pin US strings.
