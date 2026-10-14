# State

2026-10-14, Broomfield decisions + Phase 7 generalization + scheduling.
  Migration 056 RUN LIVE (owner-approved, verified: both tables exist,
  meeting_id FK has ON DELETE CASCADE per owner's follow-up ask). Pushing
  this round's commit now.

DONE+PUSHED (see git log for detail): Chipotle project seeded, queue
  decided, AgendaLink key-mismatch bugs fixed, Migration A run live,
  meeting_decisions_legistar source fields fixed+run live, event_item_id
  null-safety on site, Brookings scrape.yml reworked (meeting_decisions_
  legistar + project_updates_legistar after publish/before build,
  continue-on-error: true).

THIS ROUND (migration run live, code committed, pushing now):
1. db/migrations/056_project_updates_checkpoints.sql -- RUN LIVE. Two
   additive tables: project_updates_checkpoints (meeting_id FK ON DELETE
   CASCADE, added per owner's follow-up ask), project_updates_runs.
2. ai_pipeline/project_updates.py: incremental processing, 4 layers --
   (a) already_considered() skips the AI call for any item already in
   project_updates/project_new_candidate_queue from a prior run;
   (b) per-meeting checkpoint (own agenda_items hash, NOT meetings.
   content_hash -- that's an identity hash, never detects real content
   change) skips an unchanged meeting entirely; (c) MAX_AI_CALLS_PER_RUN=10
   hard ceiling per run, deferred items' meetings stay unchecked-pointed;
   (d) run-level gate -- main() no-ops entirely (before any DB scan) if
   < MIN_HOURS_BETWEEN_RUNS (~20h) real elapsed time since the last
   successful run for that town (project_updates_runs.last_success_at) --
   deliberately real-time-based, not an hour-of-day check, per owner's
   "scheduled runs start late/get skipped" concern. Tests (tests/
   test_project_updates_incremental.py, 11) prove both the run-gate and
   the per-item dedup independently, driving the real main() end to end
   against a fake connection. Full project-test suite: 95 passed.
3. moval-scrape.yml / broomfield-scrape.yml: project_updates.py added
   right after publish/before build, UNCONDITIONAL step (no workflow-
   level gate -- cadence is self-regulated inside the script per (d)
   above), continue-on-error: true. Cost after the fix: backlog clear
   (~24 MoVal + ~8 Broomfield unmatched candidate-shaped items measured
   live) bounded at 10 calls/run =~ $0.03/run =~ $0.12 one-time total;
   steady-state after that =~ $0.03-0.06/month/town.

NEXT: push this commit, then after the FIRST scheduled run per town
  (6h cron, but script self-gates to ~once/day): report AI calls made,
  meetings skipped, confirm last_success_at got set, per town. Then:
  Migration B (CHECK+UNIQUE on meeting_decisions) once
  meeting_decisions_legistar has fired on schedule with correct columns
  (separate thread, Brookings scrape.yml).
