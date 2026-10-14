# State

2026-10-14, 3-point follow-up after Phase 7 push (git log 68196e3..f1719ce
for the full build; previous round: pushed + deploy live-verified).

Pt1 DONE: pushed f1719ce.
Pt2 DONE, root cause found, nothing changed: moval-scrape.yml is active,
  fires on schedule (confirmed via GitHub API, run 38500838711, Oct14
  02:24 UTC, success). NOT a crash/column bug -- runner.py's existing
  refresh_minutes=1440 (24h) throttle skips city_meetings SILENTLY (no
  scrape_runs row at all, by design) whenever elapsed since last success
  < 1440min. Last real scrape: Oct13 22:01:53 GMT -- every run until
  ~Oct14 22:01 UTC will keep skipping. 053's fix can't be observed before
  then. Aside (unrelated, not fixed): several Oct11-13 runs show
  conclusion=failure, but only the LAST step (deploy-freshness check)
  fails -- scrape/publish/build/deploy already succeeded.
Pt3 DONE, real gap found: event 3540/item 100490 (Human Rights Commission,
  Aug25) is OUTSIDE legistar_v1.py's 30-day fetch window -- meetings row
  11005 exists but was never re-enriched, meeting_decisions has no row
  for it. Confirmed live: brookingsview.com/s/meeting-2026-08-25-11005/
  shows neither Decided nor On-the-agenda for it (absent, not a WRONG
  "Approved" claim). 0 denied rows exist on-site at all right now (DB
  only covers meetings from the last 30 days). Already confirmed via the
  live Legistar API (previous round), not via the deployed site. Owner
  decision needed: backfill older meetings (3540/3365/3368/3470) before
  this is confirmable ON the site -- not done without approval (rule 7).

Next: owner decision on backfilling older meetings.
