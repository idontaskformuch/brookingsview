# State

2026-10-14, Broomfield Phase 6/7 generalization -- COMPLETE through
  Migration B + meeting_decisions_agendalink.py. All three towns'
  scheduled pipelines confirmed working live.

DONE+PUSHED (see git log through 374c623): Chipotle project seeded, two
  AgendaLink key-mismatch bugs fixed, Migration A+057 run live, all three
  scrape.yml reworked (meeting_decisions_legistar/project_updates_legistar
  for Brookings, project_updates.py for MoVal/Broomfield), incremental
  processing (4 layers, now DB-observable via project_updates_runs
  counters), confirmed live via manual trigger for all 3 towns.

THIS ROUND:
1. Migration 058 (Migration B: CHECK + UNIQUE on meeting_decisions.
   source_system/source_item_id) RUN LIVE, both constraints confirmed
   present. Unblocked because meeting_decisions_legistar had already
   fired successfully with correct columns.
2. ai_pipeline/meeting_decisions_agendalink.py BUILT, verified against 8
   real Broomfield meetings (exceeds the 5-meeting bar), Chipotle meeting
   shown in full clear text before running. Key design facts, all live-
   verified before coding: AgendaLink's motions[] array order is NOT
   chronological (voteIso is -- meeting 11344's EV Charging ordinance
   proves it: "To Approve" sits before "To Amend" in the array but voted
   ~35s AFTER it); only "To Approve" is a confirmed dispositive motion
   type (unrecognized types -> 'other', never guessed); a topic's own
   hasVote flag does NOT distinguish real decisions from ceremonial items
   (confirmed True on all 23 real no-motion topics checked) so topics
   with zero motions are skipped entirely, not ingested as 'pending';
   Broomfield's whole consent agenda is one unDecomposable bulkTopic.
   13 tests (tests/test_meeting_decisions_agendalink.py), all against
   real fixtures from the live meetings. RUN LIVE for Broomfield: 38 new
   rows, 0 event_item_id set (correct), re-run confirmed idempotent (0
   new, 38 updated). Chipotle's both resolutions show outcome='approved'
   matching the live-verified 8-2 vote from earlier this session.
3. Reported to owner (not persisted anywhere, see chat): Moreno Valley's
   scrape_runs docs_attempted/docs_failed are 0 on every city_meetings
   row checked (oldest from July and today's) -- inconclusive without a
   migrations-tracking table (none exists) to pin "first row after 053";
   flagged as open, not diagnosed further this round. Also reported and
   recommended on the 7 new Moreno Valley queue candidates (#40-46): only
   #42 (Moreno Master Drain Plan Line F Detention Basin, World Logistics
   Center Specific Plan) has a real site-specific identity worth a
   project page; the other 6 are city-wide CFD annexations/financing/
   plan amendments, recommended reject, same bar as Broomfield's earlier
   Ordinance 2306 rejection.

NEXT: push this round's commit (migration 058 file + meeting_decisions_
  agendalink.py + tests). Owner to decide on the Moreno Valley candidate
  recommendations (#42 approve, rest reject) and whether to dig further
  into the scrape_runs docs_attempted finding.
