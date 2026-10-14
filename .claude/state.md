# State

2026-10-14, Broomfield decisions, executing point by point. NOT pushed
  (rule 4: no push until meeting_decisions_agendalink.py ships).

DONE:
1-3. (see commit 4b83bdf) description/details + counter/item_number key
  fixes, Chipotle project (id=16) seeded, queue #20/21 rejected, #22/23
  approved, 2 updates threaded. Stale duplicate row id=32 (artifact of the
  pre-counter-fix run) checked for FK references (none found against
  project_updates anywhere) and deleted.
4. Migration split into A/B/C/D per owner (single-step CHECK would have
  rejected every row current meeting_decisions_legistar.py writes today --
  it doesn't set source_system/source_item_id yet -- silently breaking
  Brookings' scheduled decision updates).
  STEP A: db/migrations/055_meeting_decisions_source_system.sql -- DROP NOT
  NULL on event_item_id (type/values/UNIQUE untouched), add nullable
  source_system/source_item_id, backfill existing 84 Legistar rows. NO
  CHECK/UNIQUE yet. Written, shown for approval this turn, NOT yet run.
  STEP B (next, after A runs): update meeting_decisions_legistar.py (+
  any other writer) to always set source_system='legistar'/
  source_item_id=event_item_id::text, with test; push after approval;
  confirm against next scheduled Brookings run that new/updated rows carry
  both fields before moving to Step C.
  STEP C: Migration B (056, not yet written) adds the CHECK + UNIQUE, once
  B is confirmed live.
  STEP D: only then build meeting_decisions_agendalink.py.
5. Pre-AgendaLink-write code search for event_item_id reads (rule 7's
  "innan AgendaLink-rader skrivs"): meeting_decisions_legistar.py,
  verify_meeting_decisions_legistar.py, both backfill scripts are all
  already Legistar-scoped by construction (gated on raw_data?'EventItemId'
  or hardcoded --client), unaffected by dropping NOT NULL. Two real site-
  side fixes needed and made: site/src/lib/meeting-decisions.ts's
  MeetingDecision.event_item_id type (number -> number | null), and
  site/src/lib/db.ts's getMeetingDecisions() ORDER BY event_item_id ASC ->
  ASC NULLS LAST, id ASC (ordering among a future all-NULL AgendaLink
  meeting's own rows was otherwise nondeterministic -- Legistar rows
  unaffected, never NULL). Tests added (meeting-decisions.test.ts,
  db.test.ts source-text guard); full site vitest run: 948 passed.

NEXT: run migration 055 once owner approves this turn's SQL, then build
  ai_pipeline/meeting_decisions_agendalink.py (point 3 of the original
  research-doc plan), study-session wording (point 4), Broomfield
  case-number regex for queue dedup (point 5), home-sales data_pending
  listing fix (point 6, separately approved, not started).
