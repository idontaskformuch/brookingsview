# State

2026-10-16. Round 3 pushed (53b629c, confirmed earlier this session).
  One new commit since, NOT yet pushed: d81837e (CLAUDE.md rule #11,
  pipefail/exit-code requirement) -- awaiting owner's explicit push "ja"
  (not covered by the prior "pusha de 6 committarna" approval, which was
  for the round-3 commits specifically).

THIS EXCHANGE:
  1. CLAUDE.md rule #11 added (committed, not pushed): build/test
     commands must never pipe through tail/head without set -o pipefail
     or a PIPESTATUS check -- exit codes must always be checked. Direct
     result of this session's own `| tail -10` masking a transient Neon
     "fetch failed" during a Moreno Valley build (see round-3 notes).
  2. Answered in plain text (not repeated here, see conversation): the
     45/10 vs 3-pair discrepancy (raw `events`-table duplication vs.
     duplicate PUBLISHED stories -- only 3 pairs + 1 manual were ever
     actually live), and the quorum-notice backfill's exact scope (23
     rows updated, 5 skipped, why, owner's explicit approval).
  3. QA follow-up (read-only, reported, nothing changed): supplementary
     sampling for Moreno Valley + Broomfield since the original Oct audit
     gave them a smaller sample than Brookings (subagent rate-limit
     failure that session).
     - Moreno Valley, 15 events (date/time vs source): 15/15 MATCH, 0
       mismatches. Verified via each source page's embedded JSON-LD
       startDate (explicit -07:00 PDT offset) + cross-checked all 10
       Tockify URLs' own embedded millisecond timestamps.
     - Broomfield, events: RECONFIRMED broomfield_co's `events` table
       still contains ONLY nws_alert rows (0 real local events, 0
       published event stories) -- same known gap from an earlier
       session, not newly broken. Substituted 15 of the site's
       Ticketmaster "What's On" listings instead (the only real
       externally-verifiable event-like content Broomfield has).
       15/15 MATCH, 0 mismatches (direct Ticketmaster.com fetches 401'd
       bot-blocked; verified against TM-derived secondary sources --
       TickPick/Stereoboard/SeatGeek -- instead, per the task's own
       fallback instruction).
     - Broomfield, 5 decisions vs live AgendaLink: a DIFFERENT meeting
       (id 11344, Sep 9) than the one already deep-verified during
       yesterday's backfill work (id 11341, Sep 23), to broaden real
       coverage rather than re-check the same data. 5/5 MATCH -- exact
       title + outcome (motionType "To Approve"/votingResult True ->
       "approved") for every one, done directly (not delegated).
     RESULT: 0 discrepancies across all 35 checked data points (15+15
     events, 5 decisions). Nothing to fix from this follow-up.

PRE-EXISTING OPEN ITEMS, unchanged:
  - Legistar raw_data-overwrite data loss (5 known-affected Brookings
    meeting_ids: 1314, 2428, 10973, 11006, 11009) -- flagged last round,
    not scheduled.
  - QA finding #9 (Celebration Park hours, Moreno Valley) -- info-only,
    unverified, lowest priority, not scheduled.
  - Broomfield's missing local-events scraper (confirmed again this
    exchange, originally found in an earlier session per memory) --
    the structural reason Broomfield has zero real "events" content to
    sample; not something this session was asked to fix.

NEXT STEP: push d81837e (CLAUDE.md rule) after owner's explicit "ja".
  Nothing else pending -- all three approved rounds live, QA follow-up
  clean.
