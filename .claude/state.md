# State

2026-10-15. Round 2 PUSHED (f7d0da5..b0e9b24..origin/main, incl. the
  idempotency fix 5cc9a6a pushed separately after). Round 3 (#6, #5)
  code done + committed, NOT pushed. Local HEAD is 2 commits ahead of
  origin/main: d523db6 (#6), bb140a3 (#5). Quorum-notice title backfill
  (23 of 28 rows) shown as dry-run below -- AWAITING OWNER APPROVAL.

ROUND 2 FOLLOW-UP (this exchange, before round 3): owner asked why the
  QA report's 45/10 duplicate-group counts didn't match the backfill's
  3-pair result. Answered: the report counted duplicate RAW `events` rows
  (same real event re-scraped across runs/sources, among upcoming rows),
  not duplicate PUBLISHED stories -- checked all 44 Brookings + 562 Moreno
  Valley raw groups against `stories`, found ZERO others with 2+
  published rows today (the rest are pending raw rows the already-
  committed pipeline fix prevents from ever becoming duplicate stories).
  Also found+fixed a small idempotency bug in the backfill script itself
  (the manual override kept re-reporting as pending after being applied)
  -- 5cc9a6a, already pushed. Confirmed via fresh dry-run: 0 remaining
  duplicate-story groups.

ROUND 3:
  #6 (static Astro.redirect() -> real 301/302): DONE, committed (d523db6).
    New resolveStaticGateRedirect() in site/server/_shared.ts, checked in
    worker.ts right after the existing /this-week/ block (same root
    cause, same fix pattern -- a real Response.redirect() at the
    Cloudflare Workers edge, before ASSETS). Covers all 14 currently-
    live-broken routes (sports/jackrabbits/vail-resorts/university/play/
    farm-report/burro-bonanza/home-sales/home-sales-archive/closures/
    workplace-watch/new-in-town/month/reviews) across all 3 towns' town-
    gating conditions, hand-duplicated from each .astro page's own
    condition (this Worker resolves town from hostname at request time,
    can't import site-config.ts's build-time SiteConfig). whats-on
    excluded -- hasWhatsOn is true everywhere today, never redirects.
    .astro pages' own Astro.redirect() calls left in place (still correct
    for local `astro dev`). Tests added in _shared.test.ts (28 passing).

  #5 (duplicate <title> tags): DONE, committed (bb140a3). New
    titleTagForStory()/formatShortMonthDay() in db.ts, wired into
    s/[slug].astro's BaseLayout title prop only (never the H1/story.title/
    JSON-LD). Scoped to event+alert (confirmed via live DB check: 83
    event + 50 alert stories affected, owner approved expanding beyond
    the originally-asked "event" scope after I surfaced this).
    SEPARATE BUG FOUND+FIXED in the same pass: ai_pipeline/publish.py's
    build_title() quorum-notice branch never appended the meeting date at
    all (regular meetings' own fallback branch two lines below it does) --
    confirmed live, 5 quorum-notice stories for a recurring real event
    sharing one title across 5 dates. Fixed to match the fallback.
    BACKFILL (scripts/backfill_quorum_notice_title_dates.py): built,
    dry-run shows 23 of 28 affected stories safe to update (recomputed by
    calling the now-fixed build_title() against each one's own
    underlying meeting -- can't drift from what a fresh publish produces
    today). NOT YET RUN -- awaiting owner approval.
    SAFETY FINDING surfaced by the dry-run itself, NOT fixed (separate,
    real bug, out of scope for today): 5 of the 28 candidates' meetings
    now have raw_data.agenda_text = NULL -- Legistar returned zero agenda
    items on a later rescrape of an old EventId, and legistar_v1.py's
    upsert REPLACES raw_data wholesale (update_columns includes
    "raw_data") rather than merging, so the richer historical agenda
    content that originally justified the quorum-notice classification
    was silently overwritten/lost. Re-running the classifier on today's
    data wrongly reclassifies these 5 as generic "City Council" meetings
    -- the backfill script detects this and SKIPS them (reported, never
    applied) rather than replacing a correct specific title with a
    misleading generic one. Affected meeting_ids: 1314, 2428, 10973,
    11006, 11009 (all brookings_sd).

PRE-PUSH VERIFICATION (all green, this session): pytest 871 passed/8
  skipped (was 870 -- +1 new quorum-notice test). vitest 1051 passed (was
  1033 -- +18 new: _shared.test.ts's resolveStaticGateRedirect coverage +
  db.test.ts's titleTagForStory/formatShortMonthDay coverage). astro
  check / 3-town build / sitemap-disjoint NOT yet re-run since round 2 --
  due before next push per CLAUDE.md rule 3.

NEXT STEPS:
  1. Owner approves/declines the quorum-notice backfill dry-run above --
     on approval, run `python -m scripts.backfill_quorum_notice_title_dates`
     for real (23 rows, title-only UPDATE).
  2. Full pre-push battery: astro check + 3-town build + sitemap/noindex-
     disjoint check (pytest/vitest already green above).
  3. Push after owner's explicit "ja" (2 local commits + whatever the
     backfill adds).
  4. Separately flagged for a future round, NOT auto-scheduled: the
     Legistar raw_data-overwrite data-loss bug above (5 known-affected
     meetings, likely more as other old quorum-notice-eligible meetings
     age past whatever triggers Legistar to stop returning agenda items).

REMAINING QA FINDINGS, not yet scheduled: #9 (Celebration Park hours,
  Moreno Valley, unverified/info-only -- lowest priority, info-only per
  the original report).
