# State

2026-10-14, Phase 6/7 Broomfield generalization -- RESEARCH ONLY, nothing
  built, per explicit owner instruction. Full findings in
  .claude/phase6-7-broomfield-research.md.

SUMMARY: AgendaLink's /api/session/minutes/{id} (native AgendaLink id, not
  our DB id) gives real structured outcomes (motionType/votingResult/roll-
  call votes) -- works today, just not called yet. Confirmed live: both
  Chipotle resolutions (2026-107, 2026-108-UR) passed 8-2 on 2026-09-08.
  Broomfield's 4 queued project candidates: recommend reject #20 (Ordinance
  2306, city-wide criteria, no site) and #21 (Dev Review Process Overview,
  no project), approve #22+#23 merged as one project ("Palisade Park
  Chipotle Mexican Grill", case_numbers 2026-107/2026-108-UR). Both Phase 6
  (projects) and Phase 7 (decisions) rendering/guardrail layers are already
  town-agnostic -- Phase 6 literally already runs for Broomfield (that's how
  the 4 candidates got queued). Phase 7 needs one new ingest script,
  ai_pipeline/meeting_decisions_agendalink.py, mirroring
  meeting_decisions_legistar.py -- blocked on one schema decision first:
  meeting_decisions.event_item_id is BIGINT (Legistar-shaped), AgendaLink's
  native topic id is a Mongo hex string, needs owner call on how to widen it.

SEPARATE FINDING (not part of this ask, checked per owner's note, NOT
  fixed): data_pending home-sales-digest rows get published_at=now() and
  getContentByType() only filters on published_at, not generated_by -- so
  they DO render as visible cards on /home-sales/ ("Monthly digest" section)
  and /home-sales/archive/ (currently 11 rows), even though their own detail
  page and the sitemap already correctly exclude them. Proposed fix: add
  generated_by != 'data_pending' to getContentByType()'s WHERE clause.
  AWAITING OWNER GO-AHEAD (CLAUDE.md rule 8) -- do not touch until approved.

KNOWN BUGS: none new. Pre-existing, unrelated to this research: Moreno
  Valley/eSCRIBE isn't wired into meeting_decisions either yet (0 rows),
  even though the master spec lists it -- not this session's problem, noted
  for whoever picks up Phase 7 generally.

NEXT: awaiting owner decisions on (1) which of the 4 Broomfield project
  candidates to approve/reject, (2) event_item_id schema approach for
  Phase 7/AgendaLink, (3) go-ahead on the data_pending listing fix. Nothing
  else started -- this was explicitly a report-before-building task.
