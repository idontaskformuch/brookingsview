# State

2026-10-14, 6-point follow-up after Phase 7 push.

Pt1 DONE: pushed fec3e41.
Pt2 DONE (owner-approved, 3540 only): backfill_legistar_decisions_4_meetings.py
  wrote meetings.id=11005.raw_data (backup in backups/, 31->33 items) +
  13 meeting_decisions rows. DB-confirmed: Human Rights Commission/Jeff
  Struwe = denied, 0 Yes/7 No. 3365/3368/3470 SKIPPED by design (no
  existing meetings row -- events predate 2026-06-18 earliest scrape);
  owner chose 3540-only over creating new rows. Not yet on live page
  (static site, awaits next scheduled build -- no republish forced here).
Pt3 DONE, measured not changed: outcome lag from source_snapshots history.
  118 resolved items: p50=75h p90=382h p95=607h(~25d). 95 more (45%)
  never got a signal -- right-censored at exactly meeting_date+30d (the
  current fetch window), not necessarily stuck forever. Proposed: widen
  to ~60 days. Nothing applied.
Pt4 DONE, proposal only: 258 Brookings events/12mo; sampled 12 ->
  ~17.7 items/meeting, ~2.2 vote-eligible. Est. ~820 API calls for a
  12-month backfill (~1+258+560), ~3-4min at 0.25s delay. Nothing run.
Pt5 BLOCKED: can't schedule a cloud routine for the post-22:00-UTC MV
  scrape_runs check -- cloud routines have no access to local .env
  (DATABASE_URL). Owner must ask again after 22:00 UTC for manual check.
Pt6 NOTED, not started: deploy-freshness step fails despite successful
  deploy. Untracked .github/workflows/cf-bot-fight-probe.yml (owner's own
  one-shot diagnostic for this) left in place, owner's choice this session.

Next: owner decision on 3365/3368/3470 + 60-day window proposal; Pt5
manual recheck after 22:00 UTC; Pt6 whenever owner is ready.
