# State

Current spec: .claude/phase2-spec.md. Step A + 2d/2a/2b/2c + 3 pre-2f
fixes pushed (through d1fcc50). Farm House Collective `places` write
DONE (id 205). 2f decisions resolved (see below), building the SERP
pass now. NOT pushed since d1fcc50.

## 2f decisions resolved (2026-10-09)
1. **Midway South**: checked broomfield.org's OWN facility database
   directly (RID 38, the authoritative source, not a secondary site).
   It treats "South Midway" as a sub-section WITHIN the single combined
   "Midway Park" entry, not a separate facility. Per the owner's own
   rule, created NOTHING.
2. **Broadlands West**: confirmed via broomfield.org's own dedicated
   page (RID 8, "Broadlands West Park," distinct from East's RID 43) --
   address matches our row exactly (Meadow Mountain Rd & Sheridan
   Blvd). Confirmation succeeded -> kept as-is, no noindex.
3. **Moreno Valley duplicate merge** (615ea30, mechanism only, DB NOT
   touched yet): `conference-recreation-center` (id 59) kept as
   survivor -- "internal links" tiebreak was a genuine wash (zero for
   both, confirmed by repo-wide grep), broke the tie on official-name
   match + content completeness instead (disclosed). New site/server/
   facility-redirects.json + resolveFacilityRedirect() 301s the
   retiring slug once the DB write lands. scripts/ingest_moval_
   facilities.py's _NAME_MERGE/_EXISTING_SLUG_CROSSWALK updated so a
   future re-run can't recreate the duplicate -- verified via a
   standalone simulation. Dry-run UPDATE (merged content: official name
   "Conference and Recreation Center," phone (951) 413-3280 confirmed
   via 2 independent moval.org fetches, hours_text left null -- not
   found on any official page, website = the real moval.org facilities
   page, description = id 55's richer amenities text, verified_date
   2026-10-09) + DELETE prepared, NOT executed -- awaiting owner
   go-ahead (live-DB write, rule 7).
4. McKay Lake/Conoco/Outlook/etc: not created, per instruction.

## Missing-data audit (2026-10-09, before any title changes)
All 17 owner-named Broomfield facilities + Moreno Valley City Hall +
Conference & Recreation Center checked for address/phone/hours/map/
source link. Address: 20/20 have one (real data already). Phone:
12/20 missing (parks mostly -- genuinely no public phone line for a
park, not an oversight). Hours: 13/20 missing (same pattern -- most
parks have no posted hours; Broadlands East and Bay Aquatic Park are
the two non-park exceptions worth a closer look). **Map link: 0 of 19
Broomfield facilities have lat/lon at all** -- Broomfield's facilities
were hand-curated via seed_facilities.py, never geocoded (unlike
Brookings/Moreno Valley, which went through a GIS-import script with a
real Esri geocoding step). Moreno Valley's two checked rows DO have
coordinates. This means NO Broomfield facility page can show a map
link today without a geocoding pass (a new live-DB write, separate
approval, not done). Source link: 20/20 have one (source_url already
populated everywhere). Full per-facility table given in chat, not
duplicated here.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Building 2f's SERP pass now (title pattern, address/phone/hours/map/
source above the fold, Place JSON-LD, searched-name check) -- only
showing elements that exist, per instruction. Map link omitted for
Broomfield until/unless a geocoding pass is approved. Not pushing
without approval. Separately open: the Moreno Valley merge DB write
and a Broomfield geocoding pass, both awaiting go-ahead.
