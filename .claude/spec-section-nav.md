# Handoff: Section navigation redesign (all city sites) -- pasted by owner 2026-10-21

Owner overrides: commit LOCALLY per step as usual, do NOT push without an explicit ja (spec's "do not commit" is overridden).
Moreno Valley + Broomfield: inventory + propose tabs/groups, WAIT for ja before building them. Phase 2 = review only after phase 1, no code.
Priority: nav phase 1 comes before QA Q2. Contrast fix (committed locally) is pushed together with nav phase 1 (one recrawl).

## Context
Current section nav is broken on mobile (seen live on brookingsview.com):
- Hidden overflow: seven links wrap onto two rows, remaining eight sit behind a small "MORE" dropdown readers miss.
- Wrong priority: Farm Report has a top-level slot while University (very relevant in a college town) is buried in the dropdown.
- Sticky dropdown: once opened it stays open until MORE is tapped again; overflows the right viewport edge.
Overlapping meanings: This week / What's On / Events; Closure Watch / Traffic.

## Goal and scope
Replace the nav with ONE shared, config-driven component on all three towns at once (Brookings, Moreno Valley, Broomfield); every future
city gets it by default. Pattern (approved from a mockup): single swipeable row of priority sections, a pinned **All** button at the right
edge, and a bottom sheet listing every section in groups.
Phase 1: nav component, per-town config, behavior, desktop layout. No routes change.
Phase 2: section consolidation (merge overlapping sections + 301s). Only after Phase 1 approved.

## Per-town nav config
Lives in each town's config next to the existing `features` block. Component has no town logic. Section ids map to existing routes and
their existing gating (e.g. /university stays Brookings-only).
```yaml
nav:
  tabs: [today, events, university, jacks, cityhall, traffic, jobs]
  groups:
    Now: [today, events, weather]
    Campus: [university, jacks]
    City: [cityhall, traffic, facilities]
    More: [jobs, play, farm]
```
- `tabs` = swipe row in priority order, ~7 max.
- `groups` = the All sheet; must contain EVERY enabled section, including all `tabs`. A group with no enabled sections is omitted.
- Build fails loud if: a section is in `tabs` but missing from `groups`; a section is listed twice; an id points to a route disabled for that town.
Brookings uses the values above. Labels: Today, Events, Weather, University, Jackrabbits, City Hall, Traffic & Closures, Facilities, Jobs,
Play, Farm Report.
Moreno Valley and Broomfield: inventory each town's current nav entries first, then propose `tabs` and `groups` in the same shape and WAIT
for approval. No Campus group where there is no university. Moreno sections like Workplace Watch, sports, home sales need a place in groups.

## Component behavior (mobile)
Match the approved mockup's structure; use the site's existing tokens, fonts and per-town accent colors, not the mockup's hex values.
Swipe row: one row, horizontal scroll, scrollbar hidden, no wrapping; active = bold + accent underline + aria-current="page"; on load scroll
so the active tab is fully visible; short fade at the right edge before the All button.
All button: pinned right, never scrolls away; grid icon + "All"; aria-haspopup="dialog"; aria-expanded reflects state.
Bottom sheet: opens from bottom over dimmed scrim; title "All sections", close button, then groups from config, each a two-column grid of
links; active highlighted. Closes on: selecting a section, scrim tap, close button, Esc, browser back (push a history entry on open).
role="dialog"; focus moves into the sheet on open and returns to All on close; body scroll locked while open; tap targets >= 44 px.
No-JS fallback: the sheet's links reachable without JS (e.g. <details> or a plain link to a sections list). Swipe row works without JS.
Remove the old two-row nav and MORE dropdown completely.

## Desktop
Same component and config. Row shows as many `tabs` as fit without scrolling, config order; All opens the same grouped panel (dropdown
anchored under the button is fine) that closes on outside click, Esc and selection. Nothing hangs open, nothing overflows the viewport.

## Phase 2: section consolidation (start only after Phase 1 approved; owner: review only, no code)
Begin with an audit, not code: per town list what /this-week, /whats-on, /events, /closures and /traffic contain, where they overlap, and
what each ranks for in the sitemap. Propose the merge plan and wait for approval. Intended direction (to be confirmed by the audit):
- Events becomes the single reader-facing section for This week, What's On and Events. This week image rotation and What's On
  ranking/marquee must keep working inside it.
- Traffic & Closures combines Closure Watch and Traffic. Closure Watch's rule that it must never predict a closure still applies.
- Every retired URL gets a 301; no removed route 404s. Sitemap, canonicals, BreadcrumbList, Related Content and internal links updated;
  the post-build sitemap/noindex check must still pass.

## Verification and done criteria
- [ ] astro check 0 errors; existing pytest + vitest green.
- [ ] All three towns build clean; each town's nav shows only its own enabled sections, zero cross-town leakage (University and Jackrabbits
      Brookings-only, Workplace Watch Moreno-only).
- [ ] Config validation fails the build on a missing, duplicate or disabled section id (prove with a deliberately broken config).
- [ ] Every enabled section reachable from the All sheet on every town.
- [ ] Sheet closes on selection, scrim tap, close button, Esc and back button. Focus trapped while open, returned on close.
- [ ] At 360 px width: one row, no horizontal page scroll, All button fully visible, nothing past the viewport edge.
- [ ] Contrast >= 4.5:1 for tab labels in light and dark.
- [ ] Analytics: log taps per tab and opens of the All sheet using the existing analytics setup (review after 3-4 weeks).

## Out of scope and working rules
Out of scope: footer links, page content/layout below the nav, the CityStatus strip, the ticker.
Stop and ask before guessing on anything the spec leaves open, especially Moreno/Broomfield groupings and any Phase 2 merge.
