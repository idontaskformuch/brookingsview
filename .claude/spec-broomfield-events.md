# Spec: Broomfield event sources (saved 2026-10-20; NOT committed -- spec says nothing committed until Claudio says go)

Problem: broomfieldview.com /events empty; Broomfield has zero enabled event sources in registry. Data gap, not rendering bug. Goal: coverage via existing config-driven registry, no Broomfield-specific code beyond adapters+config.

Ground rules: respect robots/crawl-delay; blocked => stop and report, no evasion. Descriptions reworded, never copied. Event detail pages noindex. LLM strings pass pre_publish_check incl. town_guard. Noise flagged not deleted. Nothing committed until Claudio says go; stage and report.

Phase 0 (report before building): verify per source platform, feed type (iCal/JSON/RSS/HTML), robots status, 10 real upcoming events, noise ratio.
 1 Compass compass.broomfield.org/events (guess LibraryMarket LibraryCalendar/Drupal)
 2 broomfield.org city calendar (guess CivicPlus; check Calendar module iCal/RSS)
 3 Ticketmaster Discovery (existing adapter; needs lat/long+radius)
 Out of scope: B-REx/WebTrac, Patch, Macaroni KID, FestivalNet.

Phase 1 Compass adapter. Flags (flag w/ reason, don't delete): room_rental (Auditorium Rental Calendar / "not a library sponsored event"), reservation, rehearsal (title starts "Rehearsal"), closure_notice (log; don't render; maybe feed Closure Watch), open_hours (not on /events; candidate for Free Things page/facility hours; report count).
 Mapping: Compass locations -> venue registry, add Broomfield venues (Library & Auditorium, Community Center, Depot Museum...). Tag kids/family, arts_culture, free only when source says so; never infer. Recurring series collapse via existing repeat-collapse.

Phase 2 city calendar: second registry source if feed exists. Dedup via render-time cross-source merge in buildEventFeed(); run SDSU/Chamber-style false-positive check, report true vs false. HTML-only => report and pause.

Phase 3 Ticketmaster/What's On: lat/long+radius in config. DECISION FOR CLAUDIO: suggested 20-25 mi; do not pick without confirmation. Capacity tiers curated from real data. Keep Sports/Athletics filter.

Phase 4 wiring: re-enable events_today in CityStatus (null-means-omit); feed free events into Free Things To Do; confirm /today TodayBlock and CityStatus match; Related Content upcoming-event rule resolves.

Verification: astro check 0 errors x3 towns; pytest+vitest green; Broomfield /events has real events in all buckets; no cross-town leakage (other builds byte-identical); detail pages noindex; sitemap/noindex disjoint; Broomfield sitemap count before/after; report events per source, flags per reason, dedup matches, failed/blocked sources.

Order: 1 Phase 0 report -> wait; 2 Phase 1+2 staged; 3 Phase 3 after radius decision; 4 Phase 4 + verification, staged not committed.
