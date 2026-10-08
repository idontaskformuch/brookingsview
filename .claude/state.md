# State

Current spec: .claude/phase2-spec.md (owner re-pasted 2026-10-08, now on
disk -- survives /clear). Step A fully done (GA4 b4621b6/d42e8c3,
events-correctness points 1-6) -- not re-detailed here, see git log.

## Known residuals (owner aware, logged not dropped)
3 rows template_fallback; "must" opinion-marker FP risk (36 rejections);
44 brookings_sd pre_publish_check rejections since 10-02 unroot-caused; 11
duplicate-title groups w/o canonical series row; ICS venue-name-dropping
accepted; local stash "superseded-broomfield-draft" owner's to drop.
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Phase 2, item 2d (Broomfield event source) -- DONE, config wired, NOT scraped live yet
configs/broomfield_co.json's data_sources.events: type "multi"/enabled
true, 3 sources. "webtrac" (kind blocked) -- re-confirmed still 403/
Cloudflare-challenged today, note preserved. "compass" (kind blocked,
NEW) -- compass.broomfield.org's robots.txt policy-blocks any generic
UA (double "User-agent: *", only named search/social/ad bots allowed
back in) -- same class as Brookings' city_parks_rec. "chamber" (kind
ical, owner-approved despite caveats) -- Broomfield Chamber's calendar,
real feed at old-events.bizwest.com/events/category/broomfield/?ical=1
(events.bizwest.com itself just 302s there, noindex'd legacy subdomain).
Live fetch+parse tested directly (not via runner, so no DB write): 1
real record parsed clean (EmpowHer, 2026-10-22, venue address in
Northglenn CO not Broomfield -- accepted, same venue-name-dropping
policy as other ICS sources). tests/test_town_parity.py + test_event_
sources.py green (45 passed/2 skipped). NOT yet run through
scrapers.runner against the live DB -- that INSERTs into live `events`,
needs owner go-ahead same as any live-DB write (rule 7), and this
is this config's FIRST-ever live run, not a rerun of prior-approved
work. Not pushed (broomfield-scrape.yml cron won't see it until pushed).

## Next
2d: get owner approval, then run `python -m scrapers.runner --config
configs/broomfield_co.json --only events` once to confirm a real insert,
check weekly.py's collect() picks it up next weekly-roundup run. Then
2a (/events structure) per phase2-spec.md.
