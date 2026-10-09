# State

Current spec: .claude/phase2-spec.md. ALL of Phase 2 (2d/2a/2b/2c/2f)
shipped and pushed, through 0886836. Moreno Valley duplicate-facility
merge executed live and verified. Phase 2 is DONE per the spec's own
"done when" checklist -- final report delivered in chat. STOPPED here
per explicit instruction; Phase 3 not started, awaiting owner review.

## Moreno Valley facility merge -- EXECUTED + verified live (2026-10-09)
Pre-write checkpoint (full before-snapshot of both rows) was saved to
this file before executing -- see git log for that exact commit if the
snapshot is ever needed again; superseded now that the merge is
confirmed good, so not repeated here. Deploy confirmed live first
(curled the old slug -> real 301 to /facilities/conference-recreation-
center/, ~6.5min after push). Then ran the UPDATE+DELETE exactly as
dry-run-approved: UPDATE rowcount 1, DELETE rowcount 1, committed.
Verified: live DB has 0 rows left under the old slug; a fresh local
build against the live DB shows the duplicate page no longer builds
at all, 0 sitemap occurrences of the old slug (down from 135->134
sitemap URLs, exactly the removed page), 1 occurrence of the survivor,
disjoint check clean; survivor page's real rendered HTML shows the
merged name/phone/description/map link correctly. Re-curled the old
slug AFTER the DB write -- 301 still works (it's a static worker-level
lookup, never touched the DB to begin with).

## Title-length budget fix (0886836, pushed)
Point-2 audit (5 longest facility titles/town) found real titles up to
95 chars -- several facility names are 50-70 chars ALONE. Fixed:
facilityTitleElements() now takes the facility name's own length + a
budget (default 60) and drops Phone first, then Hours, down to
Address-alone, down to nothing, whichever fits -- never truncates a
real facility name. Every title now provably satisfies "Name+Elements
<= 60 chars" by construction. Full per-town before/after 5-longest
tables given in chat.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Phase 2 closed. Owner reviews the final report (delivered in chat this
session, not duplicated here). Phase 3 awaits a separate, explicit
go-ahead -- not started.
