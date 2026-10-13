# State

Current spec: .claude/spec-phases-3-9.md Phase 6 (Projects & Development),
scoped to Moreno Valley only per owner's 6 decisions (2026-10-13).

## Pushed+live (origin at a6f11be)
About MV/Broomfield restructure pushed, live-verified on all 3 domains.

## Phase 6, all 6 decisions DONE this round -- 3 commits, NOT PUSHED
(0965e06 fact guardrail, 119083f noindex+vote display, 82a7077 Aquabella
data) -- owner said don't push.

1. ai_pipeline/project_fact_check.py wired into scripts/seed_projects.py,
   fail-closed. Retroactive check: all 4 pre-existing descriptions PASS.
   Did NOT wire synthesis/rolling_summary AI generation (explicitly
   deferred).
2. site/src/lib/project-noindex.ts (noindex unless updates>=2 OR a
   confirmed outcome exists), mirrored into astro.config.mjs's sitemap
   filter. PROJECT_STATUS_LABELS under_review label -> "In planning
   review" (values untouched). Verified on real builds, all 3 towns:
   disjoint clean (Brookings 107, Moreno Valley 137, Broomfield 78 URLs),
   all 5 real projects correctly indexable.
3. [slug].astro: votes always rendered as one sentence tied to the real
   outcome ("Approved by a vote of 5-0"), never shown while pending.
   pending label -> "On the agenda." Outcome already only ever came from
   Action Summary/Legistar (confirmed, no backend change needed).
4. Aquabella (PEN25-0117, VTTM 39549) verified against source, seeded
   (project id=9) with 2 real timeline rows (meeting 2192 + 13790;
   skipped 12940, a confirmed duplicate scrape of 13790). Queue row #7
   marked approved. All other 22 candidates untouched.
5. Candidate table (22 pending: 19 MV + 4 BF) with recommendations
   delivered in chat, no DB action taken.
6. No Brookings/Broomfield project data built. 5 project pages' live
   plain-text render pulled for the report.

## Known pre-existing bugs found, NOT fixed (out of scope this round)
- All 4 pre-Story-Threads project_updates rows have entry_date=NULL
  (upsert_project_update's ON CONFLICT DO UPDATE never backfills it) --
  their timeline entries render with no date. Only Aquabella's 2 new rows
  have one.
- Candidate detection doesn't dedupe by case number across occurrences:
  PEN24-0154 (rows 2+18) and PEN23-0074/5/6/7 (rows 8+9) are each the
  SAME still-unmatched story queued twice.
- Meetings 12940/13790: confirmed byte-identical duplicate scrape of one
  real eSCRIBE meeting, 13 days apart (content_hash differs, raw_data
  JSON identical) -- a scraper/ingest dedup gap.
- site/src/lib/events.test.ts's "selectWeekendNearby" describe block (3
  tests) doesn't call vi.setSystemTime like its sibling blocks do --
  fails now that real time has drifted past its hardcoded fixture date.
  Confirmed unrelated: neither events.ts nor events.test.ts touched this
  session.

## Verification (DONE)
pytest 729 passed/8 skipped/0 failed. vitest 978 passed/3 failed (the
pre-existing events.test.ts flake above, unrelated). astro check: 0
errors. All 3 towns built + sitemap/noindex disjoint verified.

## Next
Awaiting owner review of the candidate table + 5 plain-text project pages
before any push, and before generalizing to Brookings/Broomfield.
