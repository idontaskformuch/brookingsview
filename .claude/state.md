# State

Current spec: .claude/phase2-spec.md. Step A + 2d/2a/2b pushed (through
4f181e9). Farm House Collective `places` write DONE (live DB row id
205, see git log b4d0cb0/981c18a). 2c (32795c1) DONE except IndexNow --
see OPEN QUESTION below -- NOT pushed, owner reviews first.

## OPEN QUESTION -- IndexNow ping, blocks 2c from being fully "done"
phase2-spec.md says "IndexNow and Bing Webmaster already set up." Repo-
wide search (code + .github/workflows/) found NEITHER: no IndexNow key
file, no ping call anywhere, no Bing Webmaster verification tag/meta.
This is a real premise mismatch, not a small "confirm" task -- building
it needs a real per-domain key (3 towns = 3 keys), a hosted key-file at
each site root, and a trigger wired into publish/deploy. Did NOT build
this unprompted (new external-facing integration, outside what was
asked). Shipped everything else 2c asked for (see below); IndexNow
itself awaits owner direction: build it now, confirm it's handled
outside this repo already, or defer.

## Phase 2, item 2c -- DONE except IndexNow (32795c1, NOT pushed)
ItemList JSON-LD on /events/ (reuses lib/event-jsonld.ts's
buildEventJsonLd(), same builder the facet pages already use) over the
page's real display order (weekend -> nearby -> today/coming-up/
further-out). WebPage node with accurate dateModified. Real bug caught
before shipping: an arts-kind item's `published_at` is actually its
OWN FUTURE start time (artsEventAsStory()'s own doc), not a real
"last modified" signal -- including it produced a dateModified weeks
in the future. Fixed: story-kind items only; omits WebPage entirely if
none are displayed. Title/H1 simplified to "Events in {Town} | {Site}"
/ "All Events in {Town}" (was "Things to Do..."/"...Today, This
Weekend, and Coming Up"). "All" isn't decorative -- build-checks.ts's
real MIN_H1_WORDS=4 gate rejected the spec's literal 3-word "Events in
{Town}" on a real build; this is the smallest fix. Per-town tuning
hook (TOWN_OVERRIDES) already exists generically, left unused per the
spec's own "tuning comes later" instruction.
Verified: real builds all 3 towns, sitemap unchanged modulo the
already-approved facility page (105/134/77), disjoint clean,
dateModified sane (no future dates) everywhere. vitest 911, pytest
726/8 skipped, astro check 0 errors.

## Farm House Collective `places` write -- DONE, live DB row id 205
Pre-write: 0 existing rows (pure INSERT; revert = `DELETE FROM places
WHERE town_id='moreno_valley_ca' AND slug='farm-house-collective'`).
Address+hours RE-VERIFIED directly against farmhousecollective.com
itself, not just the geocoder. Moreno Valley BEFORE->AFTER (28 events
total): In town 12 unchanged. Nearby 0->16 (all real, "7 mi away" on
the live page). Unknown/excluded 16->0 -- these were never missing
data, only missing from display. New /facilities/farm-house-collective/
page has real address+hours (exceeds the noindex bar) -> correctly
indexed, confirmed on a real build. No general thin-facility noindex
gate exists anywhere in this codebase -- flagged as a latent gap, not
built (out of scope, this page isn't thin).

## Phase 2 2d/2a/2b -- done, pushed (see git log 561c295..4f181e9)
2d: Broomfield has no clean event source, closed per owner. 2a:
/events restructured + weekend-anchor Saturday/Sunday bugfix + locality
text-fallback safety fix. 2b: homepage weekend module.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
Owner decides on IndexNow (above), reviews 2c, approves push. Then 2f
(facility SERP pass) per phase2-spec.md's own remaining order.
