# State

2026-10-14, Broomfield decisions + Phase 7 generalization + scheduling.
  NOT pushed: scrape.yml changes (moved+continue-on-error'd
  meeting_decisions_legistar, added project_updates_legistar) --
  awaiting approval.

DONE (pushed through 364b482): Chipotle project seeded, queue decided,
  AgendaLink key-mismatch bugs fixed+tested, Migration A run live
  (verified), meeting_decisions_legistar always sets source_system/
  source_item_id (tested, run live for Brookings), event_item_id
  null-safety fixes on site. See git log for detail.

STEP 1+2a-Brookings (local only, in scrape.yml, NOT PUSHED): moved
  meeting_decisions_legistar to after publish/before build, added
  continue-on-error: true (visible-but-non-blocking, per owner). Added
  project_updates_legistar right after it, same placement, same flag --
  verified safe: reads ONLY each already-registered project's own
  legistar_matter_ids (data/projects/brookings_sd.json), zero AI calls,
  never INSERTs into projects, calls recompute_project_status on every
  touched project. Cost: $0 Anthropic spend, a handful of Legistar GETs.

STEP 2a-MoVal/Broomfield: BLOCKED, NOT ADDED to moval-scrape.yml or
  broomfield-scrape.yml. Owner's condition (b) is FALSE as currently
  coded: the generic ai_pipeline/project_updates.py rescans EVERY
  historical meeting every run (no incremental filter) and calls the
  real Anthropic API (ai_match_candidate) for every unmatched candidate-
  shaped item EVERY run, not just new ones -- queue_new_candidate's dedup
  only blocks a second QUEUE ROW, not the AI call itself. Measured live:
  24 such items for Moreno Valley, 8 for Broomfield today, both numbers
  only grow. Estimated recurring cost at a 6h cadence (claude-sonnet-5,
  $3/$15 per M tokens, ~500in/100out per call): ~$0.003/call x 32 items x
  4 runs/day =~ $11-12/month in pure REPROCESSING of already-decided
  history, out of each town's $20/month cap -- before any genuinely new
  candidate is evaluated. Flagged to owner, awaiting direction (needs an
  incremental/already-seen check before this is safe to schedule).

STEP 2e (traffic_project_updates): NOT scheduled, matches an existing
  in-code decision (project_threads.py's own comment: deferred pending a
  real calibration example, explicitly "do not point any workflow at
  traffic_project_updates.py yet"). No town has a traffic-sourced project
  configured. Reported, no change needed.

NEXT: owner reviews the scrape.yml diff + the cost finding above, decides
  push vs. hold, and gives direction on fixing project_updates.py's
  incremental-scan gap before Moreno Valley/Broomfield can be scheduled.
  Migration B (Step C/point 3 of this round) still waits on the Brookings
  steps firing correctly on their real 6h cron at least once, which in
  turn waits on this push.
