# State

Current spec: .claude/phase2-spec.md. Step A + Phase 2 items 2d/2a/2b
done and PUSHED (through 4f181e9, commits 561c295/de79552/a653391/
5389b13/80910c2 -- see git log for detail). Farm House Collective
`places` write DONE (b4d0cb0 checkpoint + live write, see below). Next:
2c (NOT pushed yet, see below) -- owner reviews before push.

## Farm House Collective `places` write -- DONE 2026-10-08, live DB row id 205
Pre-write (committed b4d0cb0 before executing): 0 existing rows (pure
INSERT; revert = `DELETE FROM places WHERE town_id='moreno_valley_ca'
AND slug='farm-house-collective'`). Address RE-VERIFIED directly
against farmhousecollective.com itself (footer + page text), not just
the geocoder -- exact match. Real hours found first-party on that same
site visit ("Open daily 11am-10pm") and added (upgrade over the
earlier draft's null). Ran `python -m scripts.seed_facilities
moreno_valley_ca` -- 1 inserted (this row) + 9 updated (pre-existing
Moreno Valley rows, same content re-upserted, `updated_at` touched
only -- expected/harmless, the script always processes the whole file).
Moreno Valley BEFORE -> AFTER (full event list, 28 total): In town 12
unchanged both ways (Today 0/Weekend 1/Coming up 1/Further out 10).
Nearby: 0 -> 16 (all real Farm House Collective events, each now
"7 mi away" on the real page, 6.8mi underlying). Unknown/excluded:
16 -> 0. Confirmed the 16 were NEVER missing from the data, only from
*display* -- before this write they were real rows classified
`unknown`, simply not shown in any section (not deleted, not broken).
New `/facilities/farm-house-collective/` page: has a real address AND
real hours (exceeds the "address, phone, or hours" bar) -> correctly
NOT noindexed (confirmed on a real build: no noindex meta, same as
every other complete facility page). No general noindex gate exists
for a *thin* facility page anywhere in the codebase today -- not built
here (out of scope, this page isn't thin), flagged as a latent gap for
whenever a future facility row lacks all three fields.
Verified: real Moreno Valley build, sitemap 133->134 (+1, the new
facility page, no contradiction), sitemap/noindex-disjoint clean.

## Phase 2 2d/2a/2b -- done, pushed (see git log 561c295..4f181e9)
2d: Broomfield has no clean event source, closed per owner, zero
events until one turns up. 2a: /events restructured (weekend hero,
Nearby section, Outdoor facet) + weekend-anchor Saturday/Sunday bugfix
+ locality text-fallback safety fix. 2b: homepage weekend module,
reuses weekendAnchorOffset(), hides when empty. All verified against
real builds on all 3 towns, full vitest/pytest/astro check green.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; CLAUDE.md rule 7 (live-DB writes need approval).

## Next
2c (search signals, per phase2-spec.md): ItemList JSON-LD on /events,
accurate dateModified, confirm IndexNow ping on change, title/H1 "Events
in <Town>" with a per-town config hook. Do NOT push without owner
approval (explicit instruction this round).
