# State

Current spec: .claude/spec-phases-3-9.md (read only current phase).
Phase 3 DONE + PUSHED (8d576a2). Parts 1-2 of owner follow-up done and
reported in chat; Phase 5 kickoff (Part 3) reported, 2 items GATED on
owner decision -- see Next. No code/DB changes yet this round.

## Part 1: redirect audit -- DONE, reported, nothing to fix
reviews/recipes/editorials/columns clean across all 3 towns (only
reviews.astro redirects at all, Moreno Valley only, ->'/').

## Part 2: Brookings venue audit -- DONE, reported
3 unambiguous alias fixes (City Hall, Outdoor Adventure Ctr, Wooden Legs
-- spelled-out-street mismatches). Researched+geocoded SD Art Museum/
SD Ag Heritage Museum/Larson Ice Center (Larson's hours are open-skate-
only, not general). Dry-run JSON + alias UPDATEs in chat -- GATED:
needs go-ahead before writing data/facilities/brookings_sd.json +
running seed_facilities.py (live DB write, rule 7).

## Part 3: Phase 5 -- kickoff reported, 2 items gated
About/Editorial Policy audited vs spec checklist: ALREADY compliant,
no rewrite drafted. Traffic corridors proposed per town (Moreno Valley
I-215/SR-60; Broomfield I-25/US-36/US-287; Brookings inert, no source)
w/ real road-string formats from live DB -- GATED: confirm before the
filter is built.

## Next
Awaiting owner go/no-go on: (1) venue facility writes, (2) corridor
list + building the traffic filter. Build About/Jobs/Home-Sales/Sports
parts of Phase 5 once traffic is unblocked. Stop after Phase 5, report.
