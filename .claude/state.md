# State

2026-10-14, Broomfield decisions + Phase 7 generalization, executing
  owner's point-by-point plan. NOT pushed: scrape.yml's new step
  (5ced8fa) -- awaiting approval.

DONE: Chipotle project seeded (id=16, data/projects/broomfield_co.json),
  queue #20/21 rejected, #22/23 approved. Two AgendaLink key-mismatch bugs
  found+fixed+tested (description/details, counter/item_number). Migration
  A run live (event_item_id nullable + source_system/source_item_id added
  + backfilled, 84/84 Legistar rows correct, no CHECK/UNIQUE yet).
  meeting_decisions_legistar.upsert_decision now always sets both fields
  (tested, run live for Brookings: 84 updated, verified). Pushed through
  8865ed0. meeting-decisions.ts/db.ts null-safety fixes for event_item_id
  (tested, 948 site tests pass).

STEP 3 (committed 5ced8fa, NOT PUSHED): added meeting_decisions_legistar
  as a new step in scrape.yml right after the scraper step, same 6h cron,
  no continue-on-error. No workflow anywhere invoked it before (confirmed
  via full grep). Owner's condition for Step C (Migration B: CHECK+UNIQUE)
  is this step firing correctly at least once on its real schedule --
  can't happen until pushed.

STEP 4 (research only, NOTHING BUILT per owner): inventory of Phase 6-8
  scripts' automation status presented to owner, proposal pending
  approval -- see chat for the full table. Headline: project_updates.py /
  project_updates_legistar.py / traffic_project_updates.py (Phase 6, all 3
  towns) have NEVER run on any schedule, confirmed via full workflow grep.
  seed_projects.py/review_project_candidates.py are correctly manual.
  Phase 8 ("Month in Town") has no script -- pure build-time read.

NEXT (blocked, in order): push 5ced8fa -> wait for its first real 6h cron
  firing with correct columns -> Step C (Migration B SQL, for approval) ->
  Step D (meeting_decisions_agendalink.py). Separately: owner to approve/
  reject the Step 4 scheduling proposal before any workflow file for
  project_updates*/traffic_project_updates is touched.
