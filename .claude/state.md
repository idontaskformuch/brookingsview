# State

2026-10-14, Broomfield Phase 6/7 generalization + Moreno Valley queue
  cleanup. PUSHED through 1959eb7 (origin/main up to date).

DONE+PUSHED: Chipotle project, AgendaLink fixes, Migrations A/057/B/058
  all run live, all 3 scrape.yml reworked+confirmed live, incremental
  processing (4 layers + run counters), meeting_decisions_agendalink.py
  (38 rows live, 13 tests), CLAUDE.md rule 9 ("visa X innan push" = stop
  for explicit yes in a NEW message), routine-administrative filter in
  project_updates.py (CFD annexations/reimbursement/CIP+budget
  amendments auto-rejected pre-AI unless a project signal -- case number
  or Tract Map/Specific Plan/CUP/Plot Plan/Change of Zone/Development
  Agreement -- overrides it; auto-rejected rows get status=
  'auto_rejected' + reason, not just logged; 25 tests).

OPEN:
- Migration 053 trace: ROOT CAUSE CONFIRMED (filestream.ashx 403s,
  Cloudflare challenge, live-verified; code already classifies this as
  docs_failed correctly). Waiting on the next NATURAL city_meetings run
  (throttle NOT bypassed, refresh_minutes=1440) to prove the new counters
  live. Background poll still running as of this note -- no result yet;
  check tasks/b97uz0jih.output or re-poll scrape_runs (town=
  moreno_valley_ca, source_key=city_meetings, started_at > 2026-10-14
  21:01:51 UTC) next session. Expected: docs_attempted>0, docs_failed>0,
  status='degraded'.
- Candidate #42 (Moreno Master Drainage Plan Line F Detention Basin,
  queue id=42, meeting 13782): left pending, no project created. Revisit
  if more Line F agenda items appear.

NEXT: pick up the 053 confirmation when the background poll resolves or
  on next session start. State-commits ride along with the next code
  push, not pushed separately.
