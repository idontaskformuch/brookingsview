# State

Current spec: .claude/phase2-spec.md. Step A + 2d/2a/2b/2c + 3 pre-2f
fixes pushed (through d1fcc50). Farm House Collective `places` write
DONE (id 205). 2f research + SERP pass (c164347) DONE, NOT pushed.
2f's two live-DB items (Moreno Valley merge, see below) still await
go-ahead.

## 2f part 2 -- SERP pass built + verified (c164347)
Title: "<Name> — Hours, Address & Phone | <Town>" down to just "<Name>
— Address | <Town>" for a typical park, per real per-facility data
(facilityTitleElements() in lib/facility-lede.ts). Map link
(facilityMapLink()): a real Google Maps search URL from data already
on the row -- lat/lon when geocoded, the ALREADY-VERIFIED ADDRESS
STRING otherwise. CORRECTION to the earlier missing-data note below:
no geocoding pass is needed for Broomfield after all -- Maps resolves
a real address query just fine, confirmed live on a real build (Quail
Creek Park, no coordinates, got a working address-based map link).
Source link moved from the page's own bottom into the above-the-fold
facts block next to the new Map row. Place/LocalBusiness JSON-LD was
already real-data-only from earlier work, confirmed adequate, not
changed. Caught before shipping: build-checks.ts's own per-facility
build-time title sweep (runs on every real build) wasn't passing the
new Elements var -- would have hard-failed every build; fixed (uses
hours_text only, not structured hours, a documented-safe simplification
since this route's overflow check is a warning not a hard failer).
Verified: real builds all 3 towns, sitemap counts unchanged modulo
natural content drift (105/135/77), disjoint clean, map links correct
on both the coordinate and address-fallback paths. vitest 932, pytest
726/8 skipped, astro check 0 errors.

## 2f part 1 -- decisions resolved (2026-10-09)
1. **Midway South**: broomfield.org's own facility database (RID 38)
   treats it as a sub-section WITHIN the combined "Midway Park" entry,
   not a separate facility. Created nothing, per instruction.
2. **Broadlands West**: confirmed via broomfield.org's own dedicated
   page (RID 8) -- address matches our row exactly. Kept as-is, no
   noindex needed.
3. **Moreno Valley duplicate merge** (615ea30, mechanism only -- DB
   NOT touched yet): `conference-recreation-center` kept as survivor
   (the "internal links" tiebreak was a genuine wash, zero for both;
   broke the tie on official-name match + content completeness
   instead). New facility-redirects.json + resolveFacilityRedirect()
   ready to 301 the retiring slug; ingest_moval_facilities.py's
   _NAME_MERGE/_EXISTING_SLUG_CROSSWALK fixed so a re-run can't
   recreate the duplicate. Dry-run UPDATE+DELETE prepared (merged
   name "Conference and Recreation Center," phone (951) 413-3280
   confirmed via 2 independent moval.org fetches, hours left null --
   not found officially) -- STILL awaiting owner go-ahead to execute
   (live-DB write, rule 7).
4. McKay Lake/Conoco/Outlook/etc: not created, per instruction.

## CHECKPOINT -- Moreno Valley merge, before-state (2026-10-09, immediately pre-write)
Pushed 2f (856c308..c164347) + the title-length budget fix (below).
Deploy confirmed live: curled the old slug, got a real 301 ->
/facilities/conference-recreation-center/ (took ~6.5min after push).
Full before-snapshot of both rows (id 59 `conference-recreation-
center`: address "14075 Frederick St", lat 33.9164292204479/lon
-117.262363455989, content_hash dac79fa2...; id 55 `moreno-valley-
conference-and-recreation-center`: address "14075 Frederick Street",
lat 33.9165750900756/lon -117.262391453454, content_hash 6416f2a1...,
has the richer amenities description) -- unchanged from the dry-run
shown earlier, both still phone=null/hours=null. About to execute:
UPDATE id 59 with the merged content already dry-run-approved, DELETE
id 55. Revert path if ever needed: re-INSERT id 55's exact row above
(full snapshot preserved in this entry) and revert id 59's fields to
its own snapshot above.

## Title-length budget fix (before push, see commit log)
Point-2 audit (5 longest facility titles/town) found real titles up to
95 chars -- several facility names are 50-70 chars ALONE, so the full
"— Hours, Address & Phone" suffix (25 chars) blew well past the
owner's ~60-char name+elements target. Fixed: facilityTitleElements()
now takes the facility name's own length + a budget (default 60) and
drops Phone first, then Hours, down to Address-alone, down to nothing,
whichever fits -- never truncates the facility's own real name. Every
title now provably fits "Name+Elements" <= 60 chars (by construction,
not just spot-checked). Re-verified against live data after the fix --
see chat for the full before/after 5-longest tables per town.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Owner approves: (1) push of 2f (research+SERP pass, c164347 and
everything since d1fcc50), (2) the Moreno Valley Conference Center
merge DB write (dry-run already shown). After that, phase2-spec.md's
"done when" checklist is essentially complete -- next would be the
named-annual-event-series proposal (spec's own "Also:" item, a
proposal only, never implemented without a separate go-ahead) or
Phase 3 per the spec's own closing instruction.
