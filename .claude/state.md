# State

2026-10-15. QA audit follow-up, round 1. Local HEAD is 2 commits ahead of
  origin/main (prior session's QA-report commit + this round's #2/#8 fix
  commit 1d5f934) -- NOT pushed, awaiting owner's "ja" per CLAUDE.md.

DONE this round:
  - H (mobile 390px): CLOSED. Owner manually checked 390px on homepage,
    /events, event page, facility page, project page, /month/ -- no
    horizontal scroll anywhere. Was the QA report's one untested item.
  - #2 (occurs_at IS NULL): FIXED + pushed-pending. site/src/lib/db.ts
    getWorthKnowingCandidates() -- a NULL-occurs_at row now ages out by
    published_at (24h) instead of being eligible forever. Test added in
    db.test.ts (source-text guard, same pattern as the file's other
    listing-function tests -- no DB mocking seam exists for these).
  - #8 (Worth Knowing / Coming up dup): FIXED + pushed-pending. New
    excludedFromComingUp() in homepage-curation.ts unions usedSlugs (lead/
    secondary) with selectWorthKnowing()'s own picks; index.astro's `rest`
    (feeds Today/This week/Later) now filters against the union. Unit
    tests added in homepage-curation.test.ts.
  - #1 diagnosis (no fix yet, awaiting owner go-ahead):
    - Brookings: pipeline WORKS, contrary to the QA report's framing.
      meeting_decisions_legistar DID run after Oct 13 (DB confirms all 17
      decisions for meeting-2026-10-13-14140 updated 2026-10-15 10:52 GMT,
      0 pending). Live page's Decisions section already shows the real
      outcomes correctly. The real bug: the AI-written preview paragraph
      ABOVE the Decisions section is 100% future tense ("will hold",
      "will consider") and is NEVER patched post-meeting -- page
      self-contradicts (future-tense prose sitting above a Decisions list
      that already shows real outcomes). Confirmed live via curl.
    - Broomfield: ai_pipeline/meeting_decisions_agendalink.py EXISTS and
      WORKS (live-verified, 38 real decision rows in DB) but is NOT wired
      into broomfield-scrape.yml at all -- ran exactly once, manually, on
      2026-10-14 (all 38 rows share that one timestamp), covering 7
      meetings. The Sep 23 meeting (id 11341) has 0 decision rows even
      though its AgendaLink minutes ARE already publishStatus=='minutes'
      live right now -- confirmed via direct API call. Two stacked bugs:
      (a) script never scheduled anywhere, (b) its own MIN_DAYS_BEFORE_
      FETCH=60-day prefilter is stricter than the module's own documented
      3-6 week observed lag, so even if wired in, a 22-day-old meeting
      like this one would still be skipped.
    - Moreno Valley: confirmed 0 meeting_decisions rows for the whole
      town (DB query) -- expected/blocked, no change from the QA report.
    - Owner's proposed fix (date-banner line, no AI rewrite of old prose)
      not yet built -- awaiting go-ahead.
  - #7 diagnosis (no fix yet, awaiting owner go-ahead):
    - Root cause CONFIRMED: NOT timezone/DST/parsing. data/facilities/
      brookings_sd.json is a hand-curated static JSON file -- hours_text
      is a literal hand-typed string with no date/time computation
      anywhere in the render path. Public Library and City Hall were
      simply mistyped during the 2026-08-03 curation pass (verified_date
      on both). No systemic bug, no browser DST indicator involved.
    - Scope check (subagent, fresh fetch of all 4 other Brookings
      facilities with hours_text against their cited source_url):
      Dakota Nature Park, SD Art Museum, SD Ag Heritage Museum,
      Children's Museum of SD -- all 4 match their sources exactly.
      Isolated to the 2 already-known facilities, confirmed not systemic.
    - McCrory Gardens (subagent fetched its own cited source): phone
      605-688-6707; hours "Summer: Sunday-Saturday 10am-7pm (last
      admission 6:30pm)" / "Fall/Winter: Monday-Friday 10am-5pm (last
      admission 4:30pm)" + a note about extended hours for special events/
      holiday shopping. Not yet written to the JSON file -- awaiting
      go-ahead along with the two hour corrections.

NEXT STEPS: Present round-1 diagnosis to owner. On "ja": (a) write the
  date-banner meeting-page fix, (b) wire+fix the Broomfield AgendaLink
  decisions script into its cron + loosen MIN_DAYS_BEFORE_FETCH, (c) fix
  Brookings library/city-hall hours_text + backfill McCrory Gardens
  phone/hours in data/facilities/brookings_sd.json, (d) run full test
  suite + astro check + 3-town build + sitemap/noindex check, (e) push.
  Remaining QA findings (#3-6, #9) not yet scheduled -- round 2+.
