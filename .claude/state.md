# State

Master spec: HANDOFF_journey_cleanup_events.md -- STILL not on disk, never
committed (re-confirmed via git log --all this session). "HANDOFF_phase2_
consolidated.md" (asked for 2026-10-08) also doesn't exist -- doesn't match
even the master spec's own filename. Owner must supply or re-paste the
Phase 2 spec (2a-2c, 2f content unknown) before those sub-items can start.
Step A fully done (GA4 b4621b6/d42e8c3, events-correctness points 1-6) --
not re-detailed here, see git log; not pushed.

## Known residuals (owner aware, logged not dropped)
3 rows template_fallback; "must" opinion-marker FP risk (36 rejections);
44 brookings_sd pre_publish_check rejections since 10-02 unroot-caused; 11
duplicate-title groups w/o canonical series row; ICS venue-name-dropping
accepted; local stash "superseded-broomfield-draft" owner's to drop.
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Phase 2, item 2d (Broomfield event source) -- investigated 2026-10-08, NOT built
Re-confirmed dead: WebTrac (cobroomfieldweb.myvscloud.com) still 403s
with Cloudflare challenge today (only entry in data_sources.events,
enabled:false). NEW dead end found: compass.broomfield.org (city's
newer library/rec/history program platform) -- robots.txt blocks every
generic UA via a double "User-agent: *" block (only named search/social/
ad bots explicitly allowed), same policy-block class as Brookings'
city_parks_rec; not scraped, per house rule.
ONE non-blocked candidate found, NOT wired in, awaiting owner decision:
Broomfield Chamber's calendar on events.bizwest.com permanently 302s
every /events/ path to old-events.bizwest.com (X-Robots-Tag: noindex,
permissive robots.txt, real `?ical=1` export, same plugin/pattern as
Brookings' chamber source). Caveats: only 1 event in /events/category/
broomfield/ right now (EmpowHer, Oct 22), its own venue is in Northglenn
CO not Broomfield, and the "old-" noindex subdomain smells like a
platform migration that could disappear. Thin enough to need an explicit
go/no-go before building the 'ical' source entry + config wiring.

## Next
Get Phase 2 spec from owner (2a-2c/2f unknown). Decide BizWest source
go/no-go. 2d otherwise blocked as before.
