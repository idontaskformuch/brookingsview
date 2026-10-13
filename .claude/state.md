# State

Current spec: .claude/spec-phases-3-9.md Phase 6 (Projects & Development),
scoped to Moreno Valley only per owner's 6+7 decisions (2026-10-13).

## Pushed+live (origin at a6f11be)
About MV/Broomfield restructure pushed, live-verified on all 3 domains.

## Round 1 (6 decisions) -- 4 commits: 0965e06, 119083f, 82a7077, 054b881
Fact guardrail wired+retro-checked (4/4 pass); noindex rule + vote/outcome
display fixed; Aquabella (PEN25-0117) seeded+verified; candidate table
delivered; no Brookings/Broomfield data built. Full detail in those
commits' messages.

## Round 2 (7 follow-up decisions) -- 5 commits: 749a6e1, 189be4a, c54b7ed,
## 2e7aee4, 11f3ca4 -- NOT PUSHED
1. entry_date backfill: 11 rows (before-state logged below), SQL run:
   `UPDATE project_updates SET entry_date = meeting_date WHERE entry_date
   IS NULL;` -- 0 remain NULL. Both upsert_project_update() ON CONFLICT/
   UPDATE paths (eSCRIBE project_updates.py + Legistar
   project_updates_legistar.py) fixed to set entry_date on every future
   rerun, not just first INSERT.
2. events.test.ts "selectWeekendNearby" block: added the same
   vi.useFakeTimers()/vi.setSystemTime() pattern its sibling blocks
   already use (it alone was missing it -- real root cause). 130/130 pass
   now; full vitest suite green.
3. pendingReason() MV string -> "Outcome not yet published."
4. Phase 7 research (NOT built): see "Planning Commission minutes
   research" below.
5. Dry-ran `python -m ai_pipeline.project_updates --config
   configs/moreno_valley_ca.json --dry-run`: Aquabella matches cleanly by
   case number (no CANDIDATE/AI-match lines). BUT it would add a 3rd,
   duplicate-looking timeline row next real run, because meeting 12940
   (the already-flagged scrape duplicate of 13790) independently matches
   too -- a consequence of the pre-existing meeting-dedup gap, not a
   matching bug. Not fixed (meetings-table dedup is out of scope).
6. Candidate-queue dedup by case number: ai_pipeline/project_registry.py
   gained extract_case_numbers(); ai_pipeline/project_threads.py gained
   has_pending_case_number_duplicate() + queue_new_candidate() now
   returns False (skips insert) on a case-number match already
   pending_review for that town. 9 new tests (4 extraction, 5 dedup/skip,
   all mock-conn, no real DB in unit tests -- matches this suite's
   existing convention). Live sanity-checked against the real queue
   (read-only): correctly would-dedupe PEN24-0154's appeal, correctly
   would NOT dedupe a fresh case number. Does NOT cover Broomfield's
   Resolution/Ordinance numbering (different shape, out of scope).
7. 3 more projects seeded (fact-guardrail checked, 0 rejected), timelines
   populated the same scoped way as Aquabella (match_project +
   upsert_project_update directly, never the full pipeline -- avoids
   re-triggering AI candidate detection on the 10 still-untouched rows):
   - self-storage-indian-alessandro (id=13, PEN24-0154): 2 updates
     (meetings 11181, 11412). Queue rows #2+#18 -> approved.
   - edgemont-commerce-center (id=14, PEN23-0074/5/6/7): 2 updates
     (meetings 2192, 8298). Queue rows #8+#9 -> approved.
   - brodiaea-residential-development (id=15, PEN25-0010/1/2/4): 1 update
     (meeting 8298) -- will noindex under the >=2-updates rule, correctly.
     Queue row #10 -> approved.
   Rejected (CFD annexations + procedural, no real development content):
   queue rows #3, #4, #11, #12, #13, #16, #17 -> status='rejected'.
   Queue tally now: 6 approved, 7 rejected, 10 pending_review (6 MV: #1,
   #5, #6, #14, #15, #19 -- all "uncertain" from the candidate table;
   4 Broomfield: #20-#23) -- all left untouched per explicit instruction.

## Planning Commission minutes research (Phase 7 lead, NOT built)
Confirmed (live web research, 2026-10-13): the existing "Planning
Commission never posts an outcome document" finding is about eSCRIBE
specifically and still holds for THAT platform, but the city publishes
Planning Commission outcomes on a SEPARATE system this pipeline has never
scraped:
- **City of Moreno Valley CDD "Minute Order" PDFs**, moval.org (not
  .gov), path shape `/cdd/pdfs/projects/<human-chosen-project-folder>/
  <CASE>_MINUTE_ORDER.pdf`. Fetched and read a REAL one for PEN24-0154
  (the self-storage CUP seeded above): certified by the Planning Manager,
  dated 4 days after the meeting (June 11 -> June 15, 2026), states the
  motion to approve FAILED 2-3 (Commissioners DeJohnette/Baker yes,
  Stephan/Taylor/Zeitz no) -- i.e. DENIED, then appealed. This is a real,
  fast (~4-day lag, vs. City Council PostMinutes' multi-week lag), signed
  official record -- but the folder name ("public-storage",
  "mcdonalds") isn't derivable from a case number, so using it needs
  either a folder-name index/crawl or a case-number -> folder mapping,
  neither of which exists yet.
- **SimpliCITY** (moval.org/simplicity): the city's own named real-time
  portal, explicitly searchable "by date, address, parcel number or
  project record number" per its own help docs -- the most promising
  lead for a STRUCTURED per-case lookup, but not live-tested this session
  (needs a session/auth check before Phase 7 can rely on it).
- Did NOT hand-type PEN24-0154's real "Denied 2-3" outcome into
  project_updates -- doing so would be silently overwritten back to
  'pending' by the next real (scraper-data-only) pipeline run, since
  outcome is always recomputed fresh from THIS meeting's own
  action_summary_items, which don't exist for Planning Commission on
  eSCRIBE. Recommendation: Phase 7 should build a real parser against one
  of the two sources above so this becomes a durable pipeline input.

## entry_date backfill -- BEFORE-STATE (owner-approved 2026-10-13)
11 rows had entry_date IS NULL (meeting_date always present, 0 ambiguous):
 id=3,proj=1,meeting_date=2026-06-25T18:00Z | id=4,proj=1,2026-07-23T18:00Z
 id=5,proj=1,2026-08-13T18:00Z | id=1,proj=2,2026-05-28T18:00Z
 id=2,proj=2,2026-06-16T18:00Z | id=6,proj=2,2026-08-18T18:00Z
 id=12,proj=3,2025-05-27T12:00Z | id=13,proj=3,2026-07-30T12:00Z
 id=14,proj=4,2026-04-07T12:00Z | id=15,proj=4,2026-04-28T12:00Z
 id=16,proj=4,2026-05-12T12:00Z

## Other known pre-existing bugs found, NOT fixed (out of scope)
- Meetings 12940/13790: confirmed byte-identical duplicate scrape of one
  real eSCRIBE meeting, 13 days apart -- a scraper/ingest dedup gap (see
  point 5 above for its concrete consequence on Aquabella).

## Verification (DONE, round 2)
pytest: 746 passed/8 skipped/0 failed (was 729/0f -- +17 from new tests).
vitest: 981/981 passed (was 978/3f -- flake fixed, suite fully green now).
astro check: 0 errors. All 3 towns rebuilt + sitemap/noindex disjoint
verified clean (Brookings 107 URLs incl. both projects w/ real dates now;
Moreno Valley 139 URLs, 5/6 projects indexed, Brodiaea correctly
noindexed; Broomfield 78 URLs, still 0 projects). 9 projects total now
live-verified in a real build: all render correctly (dates, "On the
agenda. Outcome not yet published.", vote sentences where applicable).

## Next
Awaiting owner review of the 3 new project pages + Phase 7 minutes-source
research before any push, before touching the remaining 10 untouched
candidates, and before generalizing to Brookings/Broomfield.
