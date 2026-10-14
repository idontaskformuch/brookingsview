# State

2026-10-14, follow-up 4-point task after Phase 7 build (previous task's
state collapsed; see git log 68196e3..1082270 for the full Phase 7 build).

Pt1 (split/denied/absent/tabled examples, verified vs Legistar's own
  data): DONE. Real cases found+confirmed via scripts/
  verify_meeting_decisions_legistar.py against events 3365 (split 7-1;
  denied 3-5/1-7 then approved 6-2, a real reconsideration sequence),
  3540 (denied 0-7, Human Rights Commission appt -- source's own
  ActionName says "approved", contradicted by PassedFlagName/
  MatterStatus/vote text), 3368 (denied 0-9), 3470 (tabled 6-0 with 2
  real Absent votes). Public MeetingDetail.aspx list view shows "Not
  available" for ALL rows regardless of real outcome (a template quirk,
  not missing data) -- compared against EventItemActionText/
  PassedFlagName/MatterStatus/vote list instead, Legistar's own
  authoritative fields, not a guess.
Pt2: DONE. (a) confirmed+verified in code (not just agent claim):
  ai_pipeline/publish.py's already_has_a_story() (line 563) gates on
  stories.meeting_id (meetings.id), checked BEFORE any AI/slug work,
  NOT conditioned on published_at -- raw_data changes can't retrigger
  it. (b) tests/test_outcome_override_precedence.py (new): override
  wins per-row (real guarantee), but NOT project-wide over a newer
  real outcome -- corrected an overclaim in the ask, didn't just
  confirm it.
Pt3: DONE, pushed (baa92ba..1082270, includes a 3rd commit for the
  override test). Live deploy verification in progress (background
  task polling brookingsview.com for the Decided section).
Pt4: MV scrape_runs still shows no post-053-fix run as of last check
  (latest row still Oct 13 22:01 UTC, pre-fix). Will report the row
  once one lands or on request.

Next: report live-deploy result + Pt4 status to owner when they land.
