# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3 DONE + PUSHED (8d576a2). Mid 3-part owner follow-up before
Phase 5 (approved in chat; not all done yet -- see Next).

## Part 1: redirect audit (DONE, nothing to fix, not yet reported)
Checked reviews/recipes/editorials/columns, all 3 towns, for a
noindex-to-noindex redirect like the one fixed in 48f05a7. Only
reviews.astro redirects at all (Moreno Valley only, ->'/'). The other
three never redirect, always render their own noindexed page, every
town. Moreno Valley's /columns/ already folds in media_recension
content -- no orphaned reviews content anywhere. Clean.

## Part 2: Brookings venue audit -- IN PROGRESS, nothing written yet
Need: alias-match the 37 unresolved venue_raw strings (see
events_correctness_phase2_project memory) vs existing facilities via
buildVenueIndex()/resolveVenue() (lib/events.ts); report only
unambiguous matches, list uncertain ones, no new pages. Then research
official address/phone/hours for SD Art Museum, SD Ag Heritage Museum,
Larson Ice Center; prepare a dry-run of possible new places rows for
approval. Mosaic Wine Bar + bare addresses: no pages (owner said so).

## Part 3: Phase 5 -- NOT STARTED
Draft About/Editorial Policy only (no publish); propose per-town
Traffic corridor lists and report BEFORE building the filter.

## Next
Finish+report Parts 1-2, then start Part 3. Stop after Phase 5, report.
