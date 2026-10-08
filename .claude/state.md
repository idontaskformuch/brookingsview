# State

Current spec: .claude/phase2-spec.md. Step A + 2d/2a/2b/2c pushed
(through 3afe29c). Farm House Collective `places` write DONE (live DB
row id 205). 3 pre-2f fixes DONE (d9fd577/50344ae/bf42cf6), NOT
pushed. Next: push these, then 2f point 4 (research + gap list).

## Pre-2f fix 1/3 -- unknown-locality events no longer disappear (d9fd577)
classifyEventLocality()='unknown' used to be excluded from BOTH
in_town and nearby -> silently vanished from /events/ entirely. Counts
RIGHT NOW (all 3 towns, before this fix would ever have mattered):
Brookings 0, Moreno Valley 0 (Farm House write already resolved its
16), Broomfield 0 (no events at all) -- so nothing was actively
missing today, but the bug was real and data-dependent, not
hypothetical. New shared lib/events.ts:buildEventSections(): unknown
items fold into Today/Coming up/Further out by date, NEVER the
weekend-hero bucket (that header claims "in <Town>", unearned for an
unconfirmed item) -- same plain rendering, no locality label either
way. 6 new tests, incl. one proving an unknown item at a weekend-
window date still lands in nextWeek not weekend. Homepage module
(buildWeekendSummary) intentionally untouched -- it's a true in-town-
only "this weekend" claim, not a general counter.

## Pre-2f fix 2/3 -- phase2-spec.md corrected (50344ae)
"IndexNow and Bing Webmaster already set up" removed (repo-wide search
found neither). Replaced with: "IndexNow/Crawler Hints: ägaren
kontrollerar i Cloudflare." No code built for this, per instruction.

## Pre-2f fix 3/3 -- thin-facility noindex gate (bf42cf6)
facilities/[slug].astro: noindex when a facility has NONE of address/
phone/hours (hours_text OR real place_hours rows, either counts).
astro.config.mjs sitemap mirror is EXACT parity (EXISTS subquery
against place_hours), not an approximation. Live count right now: 0 of
35/64/46 facilities (Brookings/Moreno Valley/Broomfield) are thin --
pure safety net for whatever 2f adds, nothing live changes today.
Verified: real Brookings build, 105 sitemap URLs unchanged, disjoint
clean. Moreno Valley/Broomfield full-suite builds in progress as of
this checkpoint (Moreno Valley flaked once on an unrelated, already-
documented transient Node ESM "Cannot find module" error -- see
[[recurring_traffic_layer_project]]'s own note on this exact flake
class; retried).

## Earlier this session (pushed through 3afe29c)
2d (Broomfield: no clean source, closed). 2a (/events restructure +
weekend-anchor bugfix + locality text-fallback safety fix). 2b
(homepage weekend module). 2c (ItemList JSON-LD, dateModified,
title/H1 -- IndexNow deferred, see fix 2/3 above). Farm House
Collective `places` row (live DB id 205, Moreno Valley Nearby 0->16).

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Confirm Moreno Valley/Broomfield builds clean, then this round's 3
fixes await push approval. Then 2f per phase2-spec.md: research real
facility sources for the owner's named list (Broomfield/Moreno Valley/
Brookings) and report a gap list BEFORE creating any page.
