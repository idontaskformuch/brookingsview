# State

Current spec: .claude/phase2-spec.md. Step A + 2d/2a/2b/2c pushed
(through 3afe29c). Farm House Collective `places` write DONE (live DB
row id 205). 3 pre-2f fixes DONE+verified all 3 towns (d9fd577/
50344ae/bf42cf6/646f430/01db31e), NOT pushed, awaiting push approval.
2f research DONE, NO pages created -- see below. Next: owner reviews
gap list, decides on the 2 real findings below, then approves what
(if anything) gets built.

## 2f research + gap list (2026-10-08) -- NO pages created
Cross-checked every owner-named search term against the live `places`
table + direct web/official-site research.

**Broomfield -- 15 of 17 already fully covered, 2 real findings:**
Quail Creek/Paul Derda+community center/Columbine Meadows/park-and-
ride (both US 36 stations)/library (Mamie Doud Eisenhower)/recycling
center/Lac Amora/Northmoor/Bronco/Greenway/municipal court/Depot
Museum/Bay Aquatics/health+human services -- all exist, real data.
"280 Spader Way" = Broomfield Community Center's own real address,
already on that page. "Non-emergency police line" = (303) 438-6400,
already the police dept page's real phone (confirmed via live web
search). Neither is a gap; 2f's title/above-fold pass applies to the
EXISTING pages, nothing new to create.
FINDING 1: "Midway parks" (plural, as the owner wrote) -- our single
`midway-park` row's address (Midway Blvd & Kohl St) matches what
other real sources call "North Midway Park" specifically. A real,
separately-addressed "South Midway Park" (4th & Garnet St) appears to
exist with NO row in our table at all. Candidate new facility --
NOT created, needs direct confirmation against broomfield.org's own
facility database (not just a secondary source) before adding.
FINDING 2 (weaker): broomfield.org's own recreation-facilities summary
page names only "Broadlands East Park" and plain "Midway Park," not a
"Broadlands West" by that exact name -- our `broadlands-west-park`
row has its own real, distinct cross-street address (Meadow Mountain
Rd & Sheridan Blvd) so it's plausibly real, just not independently
confirmed as a separately-recognized facility yet. Also found (not on
the owner's list, surfaced by this research): McKay Lake Park, Conoco
Park, Outlook Park, Broomfield Industrial Park, Country Estates appear
on broomfield.org with no row in our table -- flagged, not requested,
not investigated further.

**Moreno Valley:**
"City Hall incl. 14075 Frederick St" -- our City Hall row (14177
Frederick St) is independently confirmed correct via official city
sources; 14075 Frederick St does NOT belong to City Hall anywhere
official. REAL BUG FOUND INSTEAD: 14075 Frederick St is the address of
BOTH `conference-recreation-center` AND `moreno-valley-conference-and-
recreation-center` -- two separate live `places` rows (different
content_hash, different display name, same real address, same
verified_date 2026-08-22, neither has phone/hours) for what's almost
certainly the same real building. A pre-existing duplicate-content bug,
not something this session introduced. Applying 2f's title pattern to
BOTH would reinforce the duplication rather than fix it -- needs a
decision (merge to one slug, keep the better name, 301 the other) before
2f touches either page. NOT changed (a live-DB delete/merge needs
owner approval, rule 7).

**Brookings:** "SDSU athletics" and "county jobs" both already served
by dedicated content hubs (/jackrabbits/, /jobs/) that aren't
`places`-table facility pages at all -- outside 2f's literal facility-
page scope. No facility-table gap. If the owner meant something more
specific (a county-government jobs page distinct from the general
Adzuna /jobs/ aggregator), that's a scope question, not a data gap.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Owner reviews the gap list above and decides: (1) Midway South --
create or skip; (2) Moreno Valley Conference Center duplicate -- which
slug to keep; (3) Broadlands West -- treat as confirmed or re-verify
first. Also: push approval for the 3 pre-2f fixes. Then 2f's actual
SERP pass (title pattern, address/phone/hours above the fold, JSON-LD)
on whichever pages are confirmed real.
