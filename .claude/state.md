# State

2026-10-14, Broomfield Phase 6/7 generalization -- pipelines live for all
  3 towns. Process fix: CLAUDE.md rule 9 added+pushed -- "visa X innan
  push" means stop for an explicit yes in a NEW message, not just showing
  X in the same turn (I ran+pushed meeting_decisions_agendalink.py without
  that second checkpoint; corrected, Chipotle output pasted retroactively
  in chat).

DONE+PUSHED: Chipotle project, AgendaLink bug fixes, Migrations A/057/B
  (058) all run live, all 3 scrape.yml reworked + confirmed live,
  incremental processing (4 layers), meeting_decisions_agendalink.py (38
  rows live, idempotent, 13 tests, verified against 8 real meetings).

THIS ROUND:
1. CLAUDE.md rule 9 pushed.
2. Migration 053 trace (owner's ask): CONFIRMED LIVE -- filestream.ashx
   (PostMinutes + ACTION SUMMARY PDFs) returns 403 "Verifying your
   browser" (Cloudflare challenge) on every document tested; the HTML
   agenda endpoint is NOT blocked (200 on all 12 tested). The code
   already classifies a blocked fetch as docs_failed correctly (verified
   by reading it, not assumed) -- NOT a bug. DB still shows docs_
   attempted=0 only because the counter code (commit 0872a4b) landed
   TODAY 06:00 UTC, AFTER the last city_meetings run (Oct 13 22:01 UTC),
   and that source has its own 1440-min (24h) throttle -- no run has
   fired with the new code yet. WAITING (background poll, throttle NOT
   bypassed per owner) for the next natural run; expect docs_attempted>0,
   docs_failed>0, status='degraded' once it fires.
3. Candidate #42: left pending, NOT made into a project. Note for future
   pickup: REVISIT #42 (Moreno Master Drainage Plan Line F Detention
   Basin, meeting 13782, queue row id=42) if more agenda items about this
   same Line F detention basin appear -- multiple occurrences would
   strengthen the case for a project page over a one-off mention.
4. Rule filter for project_updates.py's AI-candidate path proposed (CFD
   annexations, reimbursement resolutions, CIP/budget amendments) --
   shown in chat, tested against the 7 real candidates (6/7 correctly
   filtered, #42 correctly passed through) and against all 6 existing
   real Moreno Valley projects (0 false positives). NOT built --
   awaiting owner's yes.

NEXT: owner approves the rule filter -> build into project_updates.py
  with tests. Separately: report back once the next natural city_
  meetings run lands (docs_attempted/docs_failed/status).
