# State

Current: today's 3-point task (2026-10-14). Point 1 DONE+committed (code+
tests only -- DB write blocked, see below). Point 2's premise was disproven
by research -- STOPPED, awaiting owner decision. Point 3 DONE (research
only, nothing built).

## Session-wide blocker: live DB access denied by auto-mode classifier
EVERY db.get_conn() call this session was denied -- both a SELECT ("Modify
Shared Resources") and an ALTER TABLE adding nullable columns ("Production
Deploy"). Not a judgment call on my part; the harness itself blocked it.
Next session: either run DB scripts in a permission mode that allows it, or
have the owner run the commands below directly.

## Point 1: doc-fetch-failure visibility -- DONE (code+tests), DB write pending
Commit 0872a4b. escribe_v1.py (agenda/minutes/action-summary) and
legistar_v1.py (eventitems) now count docs_attempted/docs_failed/
docs_last_error on FetchResult; runner.py downgrades status to 'degraded'
when every attempted doc fetch failed (was 'ok' even at 0-of-N). New
db/migrations/053_scrape_runs_doc_errors.sql adds 3 nullable columns to
scrape_runs -- additive only, no backfill possible (past rows predate this).
Tests: test_escribe_v1.py (3 new), test_legistar_v1_fetch.py (new, 2),
test_runner_doc_errors.py (new, 3). Full pytest 760 passed/8 skipped,
vitest 998/998, astro check 0 errors (no site/ files touched, so 3-town
build not run -- see blocker above, it needs DB too).
NEXT: owner runs `psql "$DATABASE_URL" -f db/migrations/053_scrape_runs_doc_errors.sql`
(or grants DB access next session). The "report per-city history" ask
could not be run this session (blocked) -- rerun the report query once
the migration's applied AND DB access works; before that, scrape_runs has
no docs_attempted/docs_failed data to report on at all.

## Point 2: Brookings Legistar "duplicates" -- STOPPED, premise disproven
Root cause found live against webapi.legistar.com/v1/cityofbrookings
(no DB needed): the 10 Brookings "duplicate (town,body,meeting_date)"
groups from round 5 are near-entirely **Legistar's own "Notice of Quorum"
postings** (open-meetings-law notices that a quorum of a body will be
informally present somewhere) plus a couple of joint City/County meetings
-- REAL, DISTINCT events that legitimately share a body+calendar-date with
that body's regular meeting, not duplicate rows. Verified several pairs
individually (EventId + EventTime + EventLocation + EventComment all
differ): Historic Preservation Commission 2026-10-10 (3841 11am Children's
Museum vs 3842 1:30pm Cubby's), City Council 2026-09-15/09-08/08-25 (regular
6pm Chambers meeting vs a same-day Notice of Quorum at a different venue),
Planning Commission 2026-02-03/04-07 (regular meeting vs a later joint
City/County session). One early WebFetch summary falsely claimed a true
dup on 2026-01-20 (EventId 3553) -- direct re-check proved it was a
mis-attributed date (3553 is actually 2026-05-19); there is NO confirmed
true duplicate found yet.
Conclusion: GROUP BY (town, body, meeting_date) is the wrong duplicate
definition for Legistar data -- it conflates "same calendar day" with
"same event." The scraper/DB layer already handles these correctly
(different EventId -> different content_hash -> correctly separate rows).
There is no scraper bug to "fixa med test" the way eSCRIBE's hash-drift
bug was real. **Did NOT dry-run or mark any of the 10 Brookings pairs as
superseded_by_slug** -- doing so on this premise would hide real, distinct
meeting content. Did NOT touch duplicate-story-redirects.json.
NEXT: owner decides whether to (a) drop this as a non-issue for Brookings,
or (b) have me re-derive the exact 10 pairs from the live `stories`/
`meetings` table (needs DB access) and check each one's EventTime/location
before any supersede action -- only pairs with IDENTICAL time+location
(a true re-entry) would qualify. Moreno Valley's 10-11 pairs were NOT
re-examined this session (that side's root cause -- content_hash drift --
was already confirmed real in round 5; this session only found a problem
with the detection heuristic on the Brookings/Legistar side). The MV dry
run + mark-as-superseded + duplicate-story-redirects.json replacement is
still a live ask, just also blocked on DB access this session.

## Point 3: Phase 7 research -- DONE, nothing built
(a) Brookings/Legistar coverage, verified live against real data (events
3360/3797/3835, matter 9342): per real agenda item, Legistar gives
MatterStatus (Passed/Failed), ActionName/ActionText (full prose: who
moved/seconded, outcome), Mover/Seconder names, PassedFlag/PassedFlagName.
**New finding, not yet acted on**: `GET /eventitems/{MatterHistoryId}/votes`
returns the full PER-MEMBER vote breakdown (name + Yes/No/Absent) --
confirmed MatterHistoryId IS the same ID as EventItemId (verified: matter
9342's history row MatterHistoryId=100723 matches eventitems'
EventItemId=100723 for the same real motion, and the votes response's own
VoteEventItemId=100723 confirms it). This directly contradicts
ai_pipeline/project_updates_legistar.py's own docstring claim that "a
reliable ID mapping wasn't confirmed" for vote_yes/vote_no -- it exists,
just unused. Coverage of tracked projects: only 2 Brookings projects are
currently seeded (data/projects/brookings_sd.json), both Legistar-matter-
sourced, both already getting outcome/action-text; neither gets numeric
vote tallies (the gap above).
(b) Moreno Valley HTML-minutes / moval.org: pub-morenovalley.escribemeetings.com
returned 403 to a plain external fetch (same Cloudflare wall the scraper's
own filestream.ashx hits) -- per the owner's own "no Cloudflare bypass"
instruction, did not retry. Could NOT confirm or deny a Meeting.aspx
HTML view for minutes/Action Summary (only the Agenda HTML view is
documented/confirmed in escribe_v1.py's own docstring). moval.org's own
City Clerk pages (www.moval.org/agendas) do NOT host current minutes --
they link out to the eSCRIBE portal, plus a separate legacy archive
(movalarchive.org) that stops at 2018-2024 data, nothing for 2025-2026.
No SimpliCITY encountered or attempted. Net: no alternative path around
the Cloudflare wall exists for CURRENT Moreno Valley documents.

## Known pre-existing issues, still not fixed (unchanged from round 5)
20 duplicate meeting-row pairs beyond the one fixed in round 5 (11-ish MV/
eSCRIBE -- real bug, root cause confirmed, just not yet cleaned up; 10
Brookings/Legistar -- see Point 2 above, likely NOT real duplicates at
all, re-scope before touching).

## Next
Owner decides: (1) grant DB access or run migration 053 + the historical
report themselves; (2) Brookings dedup -- drop it, or have me re-verify
the exact DB-held pairs before any supersede action; (3) whether to act on
the Legistar per-member-vote-tally finding (point 3a) in a future phase.
Nothing pushed this session beyond committing locally (0872a4b) -- not
asked to push.
