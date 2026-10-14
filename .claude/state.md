# State

Current spec: .claude/spec-phases-3-9.md Phase 6 (Projects & Development),
scoped to Moreno Valley only. 5 rounds of owner decisions so far
(2026-10-13 x2, 2026-10-14 x3).

## Pushed+live (origin at 8253ff6, as of round 5 start)
Rounds 1-4 (15 commits) pushed and deploying. Round 5's commit (44d56b6,
story dedup + listing filters) is local, NOT yet pushed -- verifying the
live 301 is the reason to push it, see below.

## Rounds 1-4 summary (15 commits: 0965e06..8253ff6)
Fact guardrail, noindex rule, vote/outcome display, Aquabella +3 more
projects seeded, 7 candidates rejected, candidate-queue dedup, entry_date
backfilled, meeting content_hash bug fixed + dedup_check_columns safety
net, outcome_override feature (migration 052 applied live, PEN24-0154's
Planning Commission row shows "Not approved (2–3)" with a link, project
status now "Denied"), single pending-outcome wording everywhere. Full
detail in those 15 commits' own messages + earlier chat, not repeated.

## Round 5 (3 follow-ups) -- 1 commit so far: 44d56b6

1. DONE: pushed all 15 prior commits (owner approved -- migration already
   ran, satisfying "never before the migration").

2. DONE (44d56b6), NOT YET PUSHED:
   - Dry-run confirmed exactly 1 row before the UPDATE; executed:
     `UPDATE stories SET superseded_by_slug='meeting-2026-09-24-13790'
     WHERE slug='meeting-2026-09-24-12940'`.
   - site/server/duplicate-story-redirects.json (301 via worker.ts, same
     resolveLegacyMeetingRedirect() pattern as the other 2 redirect
     files; hand-maintained like facility-redirects.json -- a one-off
     dedup, not bulk script output).
   - Generalized past this one pair: audited all 22 "FROM stories" sites
     in lib/db.ts, added `AND superseded_by_slug IS NULL` to the 11
     reader-facing listing functions missing it (homepage
     candidates/compact-content/today's-feature, /city-hall/archive, the
     weekly digest + its archive, the Google News sitemap,
     related-stories). getStoryBySlug/getAllStories deliberately
     untouched (getStaticPaths needs every row so an old URL degrades via
     this same worker 301, not a 404 -- see getAllStories()'s own doc
     comment). New regression test (db.test.ts, text-based -- no mocking
     seam exists for the real Neon-backed functions here) caught a REAL
     pre-existing gap my own manual audit had missed: getRecentCompactContent
     was wrongly believed already filtered -- fixed.
   - Verified on real builds, all 3 towns, disjoint clean (Brookings 106,
     Moreno Valley 139, Broomfield 78): 12940 gone from /city-hall/archive
     and rss.xml, 13790 appears once, 12940's own /s/ page still builds
     (needed for the redirect). Full vitest 998/998.
   - NOT YET VERIFIED: the live 301 itself (needs push + deploy -- next
     step, pending owner go-ahead to push this commit).
   - MAJOR NEW FINDING while investigating (not yet acted on): **21
     duplicate (town, body, meeting_date) groups exist**, not just the
     one pair already fixed -- 11 in Moreno Valley (eSCRIBE, same
     content_hash bug, now fixed going forward) AND **10 in Brookings**
     (Legistar -- a completely different scraper/mechanism, root cause
     NOT investigated). Scrape_runs log data strongly suggests this was
     an ACTIVE, ONGOING problem, not a one-time event: city_meetings runs
     showed items_new == items_found on EVERY run checked (should drop
     to ~0 new after the first successful scrape of stable content if
     content_hash were stable) -- consistent with the hash drifting on
     every run before today's fix. Flagged for owner decision, not
     fixed -- well beyond what was asked this round.

3. DONE (Phase 7 research, nothing built). Verdict: **source counted as
   blocked**, per the owner's own explicit branching instruction. Real
   data checked (not assumption): only 3 meetings EVER have
   minutes_text/action_summary_items populated, ALL from 2026-08-24 (7+
   weeks ago) -- zero successes since, despite 5 real City Council
   Regular Meetings since then (Sept 2, Sept 16, Oct 7, etc.) that should
   carry these documents per the already-established pattern. scrape_runs
   shows these city_meetings runs completing "ok"/200 daily with no
   logged error (the per-document fetch failures are swallowed into a
   print() in escribe_v1.py, never surfaced to the `error` column) --
   consistent with, not contradicting, the Cloudflare "verifying your
   browser" challenge this session's own 2 direct fetch attempts hit on
   the same filestream.ashx endpoint. Per the owner's own instruction
   ("Om nej... stanna"), did NOT attempt the real-code-path fetch test.

## cf-bot-fight-probe.yml
Explained (file untouched): one-shot, workflow_dispatch-only diagnostic
curling all 3 production domains with the deploy-check's own User-Agent,
to see whether Cloudflare Bot Fight Mode would block GitHub Actions'
requests. Never fires on push/schedule. NOT created by this session.

## Other known pre-existing issues found, NOT fixed (out of scope)
- 20 MORE duplicate meeting-row pairs beyond the one fixed this round (11
  MV/eSCRIBE -- same bug, now prevented going forward; 10 Brookings/
  Legistar -- separate, uninvestigated root cause). See round 5, point 2.
- Meeting-listing surfaces are now generally protected (round 5), but no
  retroactive cleanup has been done for any of the 20 other pairs.

## Next
Owner decides: (a) push 44d56b6 so the live 301 can be verified (the one
remaining unverified piece of round 5, point 2), and (b) whether/how to
address the 20 newly-found duplicate pairs (11 MV, 10 Brookings) --
separate decision, not yet asked for.
