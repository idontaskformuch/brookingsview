# State

2026-10-14, Broomfield decisions + Phase 7 generalization + scheduling.
  Pushed through 63c98aa (run-gate rework). Watching for the 18:00 UTC
  cron (first real scheduled run of project_updates.py for MoVal/
  Broomfield) in the background to report last_success_at + row counts
  from the DB, per owner's ask.

DONE+PUSHED (see git log): Chipotle project seeded, queue decided,
  AgendaLink key-mismatch bugs fixed, Migration A run live,
  meeting_decisions_legistar source fields fixed+run live, event_item_id
  null-safety on site, all three scrape.yml files reworked (Brookings:
  meeting_decisions_legistar+project_updates_legistar; MoVal/Broomfield:
  project_updates.py), Migration 056 run live (checkpoints + runs tables,
  meeting_id FK ON DELETE CASCADE), incremental processing (4 layers:
  already_considered, per-meeting checkpoint, AI-call cap, real-elapsed-
  time run gate) -- all tested, 95 passed at last full run.

THIS ROUND (local only, NOT PUSHED, migration NOT yet run):
  db/migrations/057_project_updates_runs_counters.sql (NEW) -- additive
  ALTER on project_updates_runs: ai_calls/meetings_processed/
  meetings_skipped/cap_hit columns (all NOT NULL DEFAULT), so a run's own
  stats are confirmable from the DB alone, no GitHub Actions log needed.
  ai_pipeline/project_updates.py: set_last_success() replaced by
  record_run() storing all four counters; both call sites (early-exit and
  normal completion) updated. Tests extended (13 passed): round-trip of
  all counters, overwrite-on-rerun, and an end-to-end assertion that a
  real main() run persists the correct stats. Full project-test suite: 97
  passed.

NEXT: owner approves migration 057 SQL, run it live BEFORE pushing this
  code (same order as 056). Separately: report back once the 18:00 UTC
  run is observed (last_success_at per town, checkpoint row count, new
  project_new_candidate_queue rows per town) -- background poll running.
  After that: Migration B (CHECK+UNIQUE on meeting_decisions) once
  meeting_decisions_legistar has fired on schedule with correct columns.
