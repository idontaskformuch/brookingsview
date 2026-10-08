# State

Current spec: .claude/phase2-spec.md. Step A + Phase 2 items 2d/2a done
(561c295, de79552). Pre-2b verification requested by owner -- DONE, see
below. Not pushed. Next: owner reviews findings, then 2b.

## Phase 2, item 2d -- CLOSED, owner declined the live run (2026-10-08)
Findings: Broomfield -- no clean event source found. All three
candidates (webtrac, compass, chamber/BizWest) are now `kind:"blocked"`
in configs/broomfield_co.json, and `data_sources.events.enabled` is
back to `false` -- confirmed `scrapers/runner.py`'s own run loop skips
a disabled entry before ever touching its sources[], and
`broomfield-scrape.yml` calls the whole config with no override, so no
scheduled job (every 6h) can fetch any of them. Broomfield gets zero
events until a real source turns up. Chamber dry-run itself was clean
(1 real event, robots.txt permissive, correct timezone) but owner
judged it too thin to ship live: 1 event, venue ~a mil outside
Broomfield, and the 'old-events.bizwest.com' naming reads as a
platform migration that could vanish. Kept as a documented dead end
(not deleted) so this research survives if a stronger case appears.

## Phase 2, item 2a -- done (de79552), bugfix on top (a653391)
/events restructured: weekend hero (Fri/Sat/Sun), Nearby section
(town-boundary.ts, straight-line miles only), in-town-only day buckets,
new Outdoor facet. Verification found and fixed a REAL pre-existing bug
(a653391): old anchor formula broke on Saturday (jumped to next
weekend, lost Sunday) -- now one shared weekendAnchorOffset(), 31 new
tests across all 3 tz x 4 real scenarios (Fri eve/Sat aft/Sun eve/Mon
morning). 390px: verified live via Playwright (temp devDep, --no-save,
not committed) -- no horizontal scroll, screenshots clean.
Brookings Fri4/Sat3/Sun4 cross-checked against real SDSU ("A New
Brain" Oct 8-11 multi-night run) and McCrory Gardens (Fall Festival,
real Sun Oct 11) source pages -- matches exactly.
Moreno Valley: 16/28 events route through the locality TEXT fallback
(Farm House Collective venue, not in `places` yet) -- manually
geocoded, confirmed real ~6.8mi from town center (correct "nearby"),
but the text-fallback path itself has NO distance cap (unlike the
coordinate path's 25mi), a latent gap worth a `places` row + real
coords if revisited (needs live-DB-write approval, not done).
Broomfield: 0 events (expected, chamber not scraped yet).

## Known residuals (owner aware, unrelated to this round)
3 rows template_fallback; "must" opinion-marker FP risk; 44 brookings_sd
pre_publish_check rejections unroot-caused; 11 duplicate-title groups
w/o canonical row; ICS venue-name-dropping accepted; CLAUDE.md rule 7
(live-DB writes need approval, same as push).

## Next
Owner reviews this round's findings (chamber dry-run, weekend-bug fix,
locality sample, 390px). Then: approve the chamber live scrape, and/or
proceed to 2b (homepage weekend module).
