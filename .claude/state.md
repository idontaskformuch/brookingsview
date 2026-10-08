# State

Current spec: .claude/phase2-spec.md. Step A + Phase 2 items 2d/2a done.
Pre-2b verification round (4 points) DONE, see below. Not pushed yet --
owner approves push once point 1 (2d close-out) is confirmed. Next: 2b.

## Phase 2, item 2d -- CLOSED, owner declined the live run (75d4db6)
Broomfield: no clean event source found. webtrac/compass/chamber all
`kind:"blocked"` in configs/broomfield_co.json; data_sources.events.
enabled back to `false` -- confirmed no scheduled job (runner.py skips
disabled entries; broomfield-scrape.yml has no override) can fetch any
of them. Zero events until a real source turns up. Chamber dry-run
itself was clean (1 event, robots.txt ok, correct tz) but too thin to
ship: 1 event, venue ~a mil outside Broomfield, "old-events." naming
reads as a dying platform. Kept as documented dead end, not deleted.

## Phase 2, item 2a -- done (de79552), two fixes on top
1. Weekend-hero bug (a653391): old anchor formula broke on Saturday
   (jumped to next weekend, lost Sunday). Fixed: shared
   weekendAnchorOffset(), 31 new tests (3 tz x 4 real scenarios).
2. Locality text-fallback safety (5389b13, owner-requested): an
   unresolved address-shaped venue naming a different place used to
   confidently return "nearby" with no distance -- unverifiable
   against NEARBY_RADIUS_MILES. Now "unknown" (excluded) instead.
   Added a `method` (coords/text/default) tag + per-build `[locality]`
   console count by town. Moreno Valley's Farm House Collective (16/28
   events) would otherwise vanish from Nearby -- prepared (NOT run) a
   real `places` row with real geocoded coordinates in data/facilities/
   moreno_valley_ca.json; dry-run printed the exact UPSERT params
   scripts/seed_facilities.py would send. Awaiting owner go-ahead to
   actually run `python -m scripts.seed_facilities moreno_valley_ca`
   (live-DB write, rule 7).
390px: verified live via Playwright (temp devDep, --no-save, not
committed) -- no horizontal scroll. Brookings Fri4/Sat3/Sun4
cross-checked against real SDSU + McCrory Gardens source pages, exact
match.

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; ICS venue-name-dropping accepted (in_town text-
fallback path only -- nearby no longer guesses); CLAUDE.md rule 7.

## Next
Owner confirms 2d close-out -> push 2d+2a+both fixes. Separately:
approve the Farm House Collective `places` seed (live-DB write) when
ready. Then start 2b (homepage weekend module) -- hero must reuse
weekendAnchorOffset(), no new date math; hide when no events.
