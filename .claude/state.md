# State

2026-10-14, Broomfield decisions (owner-approved plan from
  phase6-7-broomfield-research.md), executing point by point. NOT pushed
  (owner's rule 4: no push until meeting_decisions_agendalink.py ships so
  the Chipotle page can show "Approved 8-2" on day one).

DONE:
1. Key-mismatch bug found while verifying candidates #22/23 against source:
   agenda_items.get("description") was always "" for AgendaLink (its parser
   stores body text under "details"). Fixed via shared
   ai_pipeline/project_registry.agenda_item_text(), used in
   project_fact_check.py + project_updates.py. Codebase-wide search found no
   other affected call sites. Tests: tests/test_project_fact_check.py (new),
   tests/test_project_registry.py (added).
2. Same bug class found mid-run: agenda_item.get("counter") is always "" for
   AgendaLink (no "counter" key; has "item_number" instead) -- caused BOTH
   Chipotle resolutions to collide on project_updates' own
   (project_id, meeting_id, agenda_counter) key, silently overwriting one
   with the other. Fixed via agenda_item_counter() helper, same pattern,
   tested (verified item_number unique/non-null across all 33 scraped
   Broomfield meetings first).
3. Queue #20/#21 rejected, #22/#23 approved. data/projects/broomfield_co.json
   created (merged project, case_numbers 2026-107/2026-108-UR, BURA spelled
   out on first mention per owner). seed_projects + project_updates run --
   project id=16 created, 2 updates threaded (ids 34, 35).

KNOWN BUG (awaiting approval to fix): row id=32 in project_updates is a
  stale duplicate from the FIRST (pre-counter-fix) run -- same resolution as
  row 34, empty agenda_counter. Needs `DELETE FROM project_updates WHERE
  id = 32` -- not yet run (live-DB write, rule 7).

NEXT: migration SQL for meeting_decisions.source_system/source_item_id
  (additive, event_item_id untouched per owner) shown for approval this
  turn, not yet run. After approval: build
  ai_pipeline/meeting_decisions_agendalink.py (point 3 of the research
  doc's plan), then study-session wording (point 4), then Broomfield
  case-number regex for queue dedup (point 5), then the home-sales
  data_pending listing fix (point 6, separately approved).
