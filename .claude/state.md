# State

Current spec: .claude/spec-phases-3-9.md Phase 6 (Projects & Development),
scoped to Moreno Valley only. 4 rounds of owner decisions so far
(2026-10-13 x2, 2026-10-14 x2).

## Pushed+live (origin at a6f11be)
About MV/Broomfield restructure. Everything below is NOT pushed yet --
owner wants final approval before push, and never before migration 052
(satisfied: migration ran first, in round 4).

## Rounds 1+2 (13 decisions, 9 commits)
Fact guardrail, noindex rule, vote/outcome display, Aquabella seeded,
candidate-queue dedup (code), 3 more projects seeded+approved, 7 rejected,
entry_date backfilled, events.test.ts flake fixed. Full detail in those 9
commits' own messages + earlier chat.

## Round 3 (4 follow-ups) -- 3 commits: 701e30e, 0bcab27, 39acbf3
1. Meeting 12940/13790 duplicate root-caused and fixed. Confirmed BY
   DIRECT COMPUTATION: 12940's stored content_hash exactly equals hashing
   the OLD naive-datetime isoformat; 13790's exactly equals the NEW
   tz-aware one -- a 2026-09-30 _parse_escribe_date timezone fix changed
   what content_hash computed for the SAME real meeting. Fix: content_hash
   now hashes the raw StartDate string directly. General backstop:
   db.upsert_records() gained dedup_check_columns (skips an insert when
   an existing row matches with semantically-identical raw_data,
   independent of content_hash). EscribeParser opts in on
   ("body","meeting_date"). 11 new tests. Dry-run proof (read-only):
   confirmed the safety net would block a 3rd row. Did NOT touch the
   existing 12940/13790 rows (resolved in round 4, see below).
2. outcome_override + outcome_override_source_url designed, migration
   written, backend (status_for_outcome, recompute_project_status) +
   frontend (lib/db.ts, [slug].astro, index.astro) all wired -- applied
   in round 4.
3. Single wording for "no outcome yet" everywhere --
   PROJECT_PENDING_OUTCOME_LABEL ("Outcome not yet published."),
   site/src/lib/db.ts, replacing 3 independently-drifted strings.

## Round 4 (migration approved + 5 follow-ups) -- 1 commit so far: [this one]

1. DONE: migration 052 applied live (owner approved the exact `psql -f`
   command). Confirmed via information_schema + pg_constraint:
   outcome_override/outcome_override_source_url both text/nullable,
   project_updates_outcome_override_needs_source CHECK present. No
   migrations-log table exists in this codebase (tracked only by the
   numbered .sql files in git history) -- flagged, not invented one.

2. DONE: wrote the override on project_updates.id=27:
   outcome_override='Not approved (2–3)', outcome_override_source_url=
   the Minute Order PDF (moval.org/cdd/pdfs/projects/public-storage/
   PEN24-0154_MINUTE_ORDER.pdf). Ran recompute_project_status ->
   self-storage-indian-alessandro status='denied'. Rebuilt all 3 towns,
   full pytest (752 passed/8 skipped/0 failed) + vitest (981/981) green,
   sitemap/noindex disjoint clean on all 3 (Brookings 106, Moreno Valley
   139, Broomfield 78). Self-Storage page live-rendered: "Denied" badge,
   "Not approved (2–3) · Minute Order" with the link on the Planning
   Commission row, City Council appeal row still "On the agenda. Outcome
   not yet published." Aquabella page re-confirmed unaffected. NOT
   PUSHED -- owner final approval still pending.

3. DRY RUN DELIVERED, NOT YET EXECUTED (owner asked to see it before
   approving, separately). Investigated the existing redirect
   architecture first: wrangler.jsonc sets run_worker_first:["/*"], so
   worker.ts always runs before any static file is served -- that's what
   makes event-series-redirects.json/legacy-meeting-redirects.json/
   facility-redirects.json work (slug->slug JSON, resolveLegacyMeeting
   Redirect(), 301 before a stale static page would otherwise be served).
   getAllStories() does NOT filter superseded_by_slug at all (only
   getUpcomingStories/getPastStories/getSignData do, and only for
   events). Proposed plan:
     a) UPDATE stories SET superseded_by_slug='meeting-2026-09-24-13790'
        WHERE slug='meeting-2026-09-24-12940'; -- 13790 is canonical: the
        one project_updates.id=26 (Aquabella) already references, and
        the post-tz-fix correctly-parsed scrape. Both stories published
        the same day 32s apart, so "older" isn't a meaningful tiebreaker.
     b) New file site/server/duplicate-story-redirects.json:
        {"meeting-2026-09-24-12940": "meeting-2026-09-24-13790"} --
        follows facility-redirects.json's precedent (hand-maintained
        one-off dedup), not the other two files (different bug classes).
     c) worker.ts: import it, add a third resolveLegacyMeetingRedirect()
        check, 301.
   FLAGGED, not expanded beyond what was asked: does NOT remove the
   duplicate from meeting-listing surfaces (homepage, /city-hall, RSS) --
   those queries don't filter superseded_by_slug (only the 3 event-only
   functions do). A real follow-up gap, not fixed here.

4. DONE (explanation only, file untouched). cf-bot-fight-probe.yml:
   one-shot, workflow_dispatch-only diagnostic curling all 3 production
   domains with the deploy-check's own User-Agent, to see whether
   Cloudflare Bot Fight Mode would block GitHub Actions' requests. Never
   fires on push/schedule. Standing tool for whenever a WAF rule is
   considered.

5. DONE (research, nothing built). Searched the 14 already-scraped
   Moreno Valley Planning Commission agendas for "Approval of Minutes" --
   0 literal hits, but found the real pattern under a different label:
   every PC meeting's Consent Calendar carries a "Planning Commission
   Minutes -- Regular Meeting - <date>" item approving the PRIOR
   meeting's minutes. Lag confirmed across 3 real examples: ~15 days
   (next regular PC meeting, roughly biweekly). Fetched the real agenda
   HTML for one (meeting 11102) and found a real attached document under
   that item: filestream.ashx?DocumentId=7051, "06.11.26_PC Minutes_
   Final.pdf" -- same eSCRIBE mechanism already used for Action Summary/
   PostMinutes elsewhere. Could NOT verify the PDF's own content (per-item
   outcomes?) -- the download endpoint returned a Cloudflare "verifying
   your browser" challenge on 2 attempts (plain, and with Referer+delay);
   did not keep retrying (would cross into working around a bot check).
   Did not use SimpliCITY.

## Other known pre-existing issues found, NOT fixed (out of scope)
- `stories` has 2 duplicate published rows for the 12940/13790 meeting --
  dry run above, awaiting owner go-ahead to execute.
- Meeting-listing surfaces don't filter superseded_by_slug (round 4,
  point 3's flag).
- Unrelated: .github/workflows/cf-bot-fight-probe.yml sits untracked in
  the working tree -- NOT created by this session, its own comment says
  "owner asked to see before deciding on any WAF rule... delete or commit
  separately once used." Left untouched.

## Next
Owner reviews the task-3 dry run and either approves it or not. Owner
gives final push approval (covers all 13 commits across rounds 1-2, 3
commits in round 3, this round's commit once made -- migration already
ran live, satisfying "never before the migration").
