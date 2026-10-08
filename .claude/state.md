# State

Master spec: HANDOFF_journey_cleanup_events.md -- not on disk, in-context copy.
Current: Step A (pre-Phase-2 cleanup) COMPLETE. Next session starts Phase 2.

## Step A -- all 6 points done
1-2: meta.when confirmed INERT (nothing reads stories.meta) -- left alone.
3 (e6ba48c): meta.cost/audience wired into cards+/s/[slug]; isFreeEvent()
fixed (meta.cost checked now too, both languages).
4 (d6411d1): rejection report script. New date/time/price/age guardrail:
4 rejections, all true positives, 0 FPs -- not narrowed.
5 (12b787c, owner-approved): Corpse Bride fabrication dropped; library-
hours "Saturday"->"Sunday" fixed. "A New Brain" investigated, no real
error, left untouched. Also (7310959) fixed a wrong test assumption in
event-series-redirects.test.ts (unrelated to the above).
6: live-checked all 3 towns -- sitemap counts match build (105/133/77);
recipe/review pages + indexes noindex and out of every sitemap; homepage
has no old "Today's read"/"Latest from"/"More to read" modules anywhere.
Minor, non-blocking: morenovalleyview.com's /reviews/ serves bare
"noindex" (others say "noindex,follow,max-image-preview:large") -- likely
a stale deploy for that one page, not a code bug; still correctly noindex.

## Known residuals (owner aware, logged not dropped)
- 3 rows still template_fallback.
- "must" opinion-marker: blanket substring, no grammar context, 36 live
  rejections both towns -- real FP risk, not yet narrowed.
- 44 brookings_sd rejections since 10-02: pre_publish_check weekday/title
  mismatch, maybe a stale county_alert row misrouted as 'event' -- root
  cause not found, own follow-up.
- 11 duplicate-title groups lack a canonical series row.
- Venue-name-dropping (ICS feeds): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push.

## Next
Phase 2, starting with 2d (Broomfield event source), then 2a-2c, 2f.
