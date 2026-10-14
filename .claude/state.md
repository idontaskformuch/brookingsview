# State

2026-10-14, 6-point follow-up, round 2 (after Phase 7 push).

Pt1 DONE: pushed 548dfc0 (59c2201/ae0edd0 pushed too).
Pt2 DONE: Legistar fetch window 30->60d (legistar_v1.py, 59c2201),
  test added. Confirmed scoped to fetch/enrichment only -- publish.py
  (story gen) reads existing raw_data, no reference to this window.
Pt3a DONE, dry-run only: scripts/backfill_legistar_outcomes_since_2026_06_18.py
  (ae0edd0). 6 Brookings meetings since 2026-06-18 have a pending
  decision-eligible item; live refetch found 0 newly-posted results --
  nothing to apply. 3365/3368/3470 still skipped (no meetings row,
  owner's prior call).
Pt3b DONE, already complete: project_updates_legistar.py --dry-run
  for both tracked projects (rti-llc-real-property-lease,
  outlot-2-section-23-rezoning) returned the exact 5 rows already in
  project_updates (ids 12-16) -- no new pre-2026-06-18 history to
  backfill, nothing written.
Pt4 DONE: confirmed live at brookingsview.com/s/meeting-2026-08-25-11005
  -- "5.B. ... Jeff Struwe. Denied - 0-7". NOTE: configs/brookings_sd.json
  "domain" (brookings311.com) does NOT resolve/isn't live; real site is
  brookingsview.com -- domain field is stale, flag to owner.
Pt5 NOT DONE (by design): owner checks MV scrape_runs after 22:00 UTC.
Pt6 NOTED: Bot Fight Mode is OFF on all 3 domains (owner-confirmed) --
  deploy-freshness failure has a DIFFERENT root cause, not yet found.
  cf-bot-fight-probe.yml left untouched; only needed if owner considers
  enabling Bot Fight Mode, remove on owner's say. When Pt6 is taken up:
  determine what the freshness check actually gets back (status code,
  headers, body) to find the real cause.

Next: owner approval needed before any real write for 3a/3b (currently
nothing pending); Pt5 after 22:00 UTC on request; Pt6 root-cause dig
whenever owner is ready; flag the brookings_sd.json domain mismatch.
