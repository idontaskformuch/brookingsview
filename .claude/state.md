# State

Current spec: .claude/spec-phases-3-9.md Phase 6 (Projects & Development),
scoped to Moreno Valley only. 3 rounds of owner decisions so far
(2026-10-13, 2026-10-13, 2026-10-14).

## Pushed+live (origin at a6f11be)
About MV/Broomfield restructure. Everything below is NOT pushed yet --
owner wants final approval before push.

## Round 1 (6 decisions, 4 commits) + Round 2 (7 follow-ups, 5 commits)
Fact guardrail, noindex rule, vote/outcome display, Aquabella seeded,
candidate-queue dedup (code), 3 more projects seeded+approved, 7 rejected,
entry_date backfilled, events.test.ts flake fixed. Full detail already in
those 9 commits' own messages + earlier chat. Not repeated here.

## Round 3 (4 follow-ups) -- 3 commits: 701e30e, 0bcab27, 39acbf3 -- NOT PUSHED

1. DONE (701e30e): meeting 12940/13790 duplicate root-caused and fixed.
   Confirmed BY DIRECT COMPUTATION (not just theory): 12940's stored
   content_hash exactly equals hashing the OLD naive-datetime isoformat;
   13790's exactly equals the NEW tz-aware one -- a 2026-09-30
   _parse_escribe_date timezone fix changed what content_hash computed
   for the SAME real meeting (same GUID, same raw StartDate), so ON
   CONFLICT never matched the old row. Fix: content_hash now hashes the
   raw StartDate string directly, never a parsed/derived value. General
   backstop regardless of hash: db.upsert_records() gained an opt-in
   dedup_check_columns param -- skips an insert when an existing row
   already matches (town_id, *cols) with semantically-identical raw_data
   (JSONB equality), independent of content_hash. EscribeParser opts in
   with ("body", "meeting_date"). 11 new tests.
   Dry-run proof (read-only, logged here): simulated a fresh scrape of
   the exact 12940/13790 meeting with the fixed code -- new hash matches
   neither existing row, but the dedup_check_columns SELECT correctly
   found row 12940 and would skip the insert. Did NOT touch the existing
   12940/13790 rows themselves (no retroactive merge/delete) -- the fix
   alone already guarantees no third row, confirmed by the dry run, and
   deleting either row risks the LIVE PUBLISHED stories rows that
   reference them (see finding below).
   FINDING, not acted on: `stories` ALSO has two separate published rows
   for this one real meeting (meeting-2026-09-24-12940 AND -13790) --
   same root cause, but a content/editorial decision (merge/redirect one)
   the owner hasn't asked for yet.

2. BLOCKED -- see "Permission needed" below. Code fully written and
   committed (0bcab27, 39acbf3), migration NOT applied to the live DB.
   - db/migrations/052_project_update_outcome_override.sql:
     outcome_override + outcome_override_source_url on project_updates,
     both-or-neither CHECK. Neither pipeline ever references either
     column -- that's the actual "pipeline can't overwrite it" guarantee.
   - recompute_project_status() (both pipelines): follows the LATEST row
     with an actual confirmed outcome (override or non-pending), not
     simply the newest row -- so PEN24-0154 (June PC denial with a real
     override, September CC appeal still pending) shows status='denied',
     not 'under_review'. No new status enum value -- "denied, appealed"
     communicated via the description + the timeline's second entry.
   - status_for_outcome(): "not approved" -> denied (checked before the
     bare "approved" substring match).
   - lib/db.ts: ProjectUpdate type + both SQL queries carry the 2 new
     columns. [slug].astro + index.astro: override takes display
     priority, shown with a link to outcome_override_source_url.
   READY TO WRITE once unblocked, exact values (row id=27,
   self-storage-indian-alessandro, Planning Commission, 2026-06-12):
     outcome_override = 'Not approved (2–3)'
     outcome_override_source_url =
       'https://www.moval.org/cdd/pdfs/projects/public-storage/PEN24-0154_MINUTE_ORDER.pdf'
   Source: real Minute Order PDF, certified by the Planning Manager,
   read in full earlier this session (2-3 vote: DeJohnette/Baker yes,
   Stephan/Taylor/Zeitz no).

3. DONE (0bcab27): single wording for "no outcome yet" everywhere --
   PROJECT_PENDING_OUTCOME_LABEL ("Outcome not yet published."),
   site/src/lib/db.ts, replacing 3 independently-drifted strings
   ([slug].astro's outcomeLabel() dead branch + pendingReason()'s generic
   fallback, index.astro's homepage teaser).

4. NOT DONE -- blocked on #2. Full rebuild/verification was going to
   include showing Self-Storage's page WITH the override rendered; can't
   build at all right now without the migration (the new SQL selects
   columns that don't exist in the live schema yet -- EVERY town's build
   would fail, not just Moreno Valley's).

## Permission needed (owner decision required before continuing)
Claude Code's own auto-mode classifier blocked running migration 052
directly against the live DB this session, flagged "Production Deploy".
Two ways to unblock, either is fine:
  a) Owner runs `psql "$DATABASE_URL" -f
     db/migrations/052_project_update_outcome_override.sql` themselves,
     tells Claude to continue -- Claude then writes the PEN24-0154
     override row (exact values above), rebuilds all 3 towns, verifies,
     shows the Self-Storage + Aquabella pages in plain text, and the
     owner does the final push approval from decision 4.
  b) Owner grants Bash permission for this kind of action (their own
     settings), Claude runs the migration itself and continues the same
     way.
No other code in rounds 1-3 is blocked -- only the override feature's
live data (point 2) and the rebuild/push (point 4) that depends on it.

## Other known pre-existing bugs found, NOT fixed (out of scope)
- `stories` has 2 duplicate published rows for the 12940/13790 meeting
  (see round 3, point 1's finding above) -- a content decision, not acted
  on without being asked.
- Unrelated: .github/workflows/cf-bot-fight-probe.yml sits untracked in
  the working tree -- NOT created by this session, its own comment says
  "owner asked to see before deciding on any WAF rule... delete or commit
  separately once used." Left untouched, flagged to owner, not part of
  any commit here.

## Verification (DONE for rounds 1-3's non-blocked parts)
pytest (all project+escribe+db-dedup test files): 77 passed (was 59
after round 2 -- +18 from round 3's new tests). vitest: 981/981 (full
suite, unchanged from round 2 -- astro check also re-run clean, 0 errors,
after fixing one test fixture (this-week.test.ts) that needed the 2 new
ProjectUpdate fields). Full 3-town build NOT re-run this round (blocked,
see above -- would fail without the migration).

## Next
Owner decides how to unblock migration 052 (see above). Once applied:
write the PEN24-0154 override row (exact values logged above), rebuild
all 3 towns, full verification, show Self-Storage + Aquabella pages in
plain text, then push everything (10 commits from rounds 1-2 + 3 from
round 3 = 13 total) after owner's final go-ahead.
