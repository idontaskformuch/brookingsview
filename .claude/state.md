# State

2026-10-14, Broomfield decisions + Phase 7 generalization + scheduling.
  Pushed through fbbda9c (Brookings scrape.yml rework). NOT pushed: this
  round's work (migration 056 + incremental project_updates.py +
  moval/broomfield scrape.yml steps) -- awaiting approval.

DONE+PUSHED (see git log for detail): Chipotle project seeded, queue
  decided, AgendaLink key-mismatch bugs fixed, Migration A run live,
  meeting_decisions_legistar source fields fixed+run live, event_item_id
  null-safety on site, Brookings scrape.yml reworked (meeting_decisions_
  legistar + project_updates_legistar after publish/before build,
  continue-on-error: true).

THIS ROUND (local only, NOT PUSHED):
1. db/migrations/056_project_updates_checkpoints.sql (NEW, NOT RUN) --
   additive-only table, needs approval before running.
2. ai_pipeline/project_updates.py: incremental processing, 3 layers --
   (a) already_considered() skips the AI call for any item that already
   has a project_updates or project_new_candidate_queue row from a prior
   run; (b) per-meeting checkpoint (own agenda_items hash, NOT meetings.
   content_hash -- that's an identity hash, doesn't detect real content
   change) skips an unchanged meeting ENTIRELY; (c) MAX_AI_CALLS_PER_RUN=10
   hard ceiling, logged once when hit, deferred items keep their meeting
   unchecked-pointed so they get retried next run. Tests (tests/
   test_project_updates_incremental.py, 10 new) PROVE a second run on
   identical data makes 0 AI calls, via a full fake-conn main() rerun, not
   just the helpers in isolation. Full project-test suite: 94 passed.
3. moval-scrape.yml / broomfield-scrape.yml: added project_updates.py
   right after publish/before build (same position as Brookings), gated
   by a tiny UTC-hour check step so it only actually runs once/day (at
   00:00 UTC) while the rest of the job stays on its existing 6h cadence
   -- continue-on-error: true.
   Cost re-estimate after the fix: backlog clear (~24 MoVal + ~8
   Broomfield unmatched candidate-shaped items today) bounded at 10
   calls/day/town =~ $0.03/day/town for a few days =~ $0.12 one-time
   total; steady-state after that =~ $0.03-0.06/month/town (only
   genuinely new/changed meetings' candidates) -- vs. the prior ~$11-12/
   month estimate for unthrottled 6h/no-incremental scheduling.

NEXT: owner reviews migration 056 SQL + the project_updates.py diff +
  both scrape.yml diffs, approves migration run, then push. Step C
  (Migration B: CHECK+UNIQUE on meeting_decisions) still waits on
  Brookings' scrape.yml steps firing correctly on the real 6h cron at
  least once (separate thread from this round).
