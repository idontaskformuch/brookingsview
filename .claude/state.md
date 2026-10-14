# State

2026-10-14, Broomfield decisions + Phase 7 generalization + scheduling.
  All three towns' reworked scrape workflows CONFIRMED WORKING via a
  manually-triggered run each (owner triggered ~20:27 UTC, since the real
  6h cron was drifting 4-9h late that day -- itself live confirmation of
  why the real-elapsed-time run gate was the right call over an hour-of-
  day check).

DONE+PUSHED (see git log through 63c98aa): Chipotle project seeded, queue
  decided, AgendaLink key-mismatch bugs fixed, Migration A run live,
  meeting_decisions_legistar source fields fixed+run live, event_item_id
  null-safety on site, all three scrape.yml reworked, Migration 056 run
  live (checkpoints + runs tables, ON DELETE CASCADE), incremental
  processing (4 layers) -- all tested.

FIRST REAL RUN RESULTS (confirmed via GitHub API + live DB, no gh CLI
  needed -- public repo's REST API works unauthenticated for reads):
  - Brookings (run #855): every step succeeded incl. the two new ones;
    meeting_decisions_legistar refreshed all 84 rows, project_updates_
    legistar ran clean (0 new -- nothing new to thread).
  - Moreno Valley (last_success_at 20:29:24 UTC): 32/33 meetings
    checkpointed, 1 left un-checkpointed (AI-call cap correctly deferred
    it to next run), 7 new candidates queued, 6 new project_updates rows.
  - Broomfield (last_success_at 20:28:26 UTC): 27/27 checkpointed, 0 new
    queue/update rows -- already_considered() correctly suppressed every
    AI call (all candidate-shaped items were already decided from
    earlier manual runs this session). 0 AI calls this run.
  Confirms both the checkpoint and already_considered layers work as
  designed in a real run, not just in tests.

THIS ROUND (local only, NOT PUSHED, migration NOT yet run):
  db/migrations/057_project_updates_runs_counters.sql -- additive ALTER
  on project_updates_runs (ai_calls/meetings_processed/meetings_skipped/
  cap_hit), so the above numbers are DB-readable next time without the
  GitHub-API-digging done this round. ai_pipeline/project_updates.py:
  record_run() replaces set_last_success(), storing all four. Tests
  extended (13 passed, 97 in full project suite).

NEXT: owner approves migration 057, run it live, then push the code.
  After that: Migration B (CHECK+UNIQUE on meeting_decisions) -- now
  unblocked, since meeting_decisions_legistar has fired successfully with
  source_system/source_item_id correctly set (verified this run).
