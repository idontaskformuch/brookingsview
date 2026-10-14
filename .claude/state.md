# State

2026-10-14, 4-point task (pts 0-3) after /clear. Previous task's work
already pushed (up to 7545e75); see git log for that history.

Pt0 DONE+committed (baa92ba): CLAUDE.md rule 8, "föreslå"/"ändra inget"
= no code till owner says yes.
Pt1 DONE (no code): scrape_runs shows no MV run yet since today's 053-fix
push (0872a4b); last row is pre-fix (Oct 13 22:01 UTC). Cron is every 6h
(moval-scrape.yml). Will recheck later, not polling continuously.
Pt2 (Phase 7, Brookings/Legistar) IN PROGRESS, NOT YET LIVE-VERIFIED:
  - New: db/migrations/054_meeting_decisions.sql, ai_pipeline/
    meeting_decisions_legistar.py, site/src/lib/meeting-decisions.ts.
  - Changed: scrapers/parsers/legistar_v1.py (fetches EventItemId/
    PassedFlagName/Consent/MatterId + /votes, matter+flag items only),
    site/src/lib/db.ts (getMeetingDecisions, getProjectForMatterId --
    strict MatterId match, independent of threadProject's meeting_id
    link which is always NULL for Legistar), s/[slug].astro ("On the
    agenda"/"Decided").
  - Verified live against cityofbrookings (not guessed): EventItemConsent
    flag + a consent sub-item's /votes response resolves to the shared
    block's own EventItemId; a real source bug where ActionName="approved"
    but PassedFlagName="Fail" (event 3540/item 100490) -- Pass/Fail flag
    wins, documented in the ingest script's docstring + a regression test.
  - vitest 1009/1009, pytest 777/8skip, astro check 0 errors.
  - BLOCKED: migration 054 NOT applied to live DB (CLAUDE.md rule 7 --
    asked owner, awaiting approval). Brookings build fails live
    ("relation meeting_decisions does not exist") until it's run. 3-town
    build/sitemap check not done yet, pending this.
Pt3 (show 5 real meetings, no push without approval): not started --
  blocked on Pt2's live verification above.

Next: get owner approval for migration 054 (+ later, running legistar_v1
and meeting_decisions_legistar.py against live DB to populate real data).
