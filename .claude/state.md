# State

2026-10-15. Round 3 COMPLETE, all verified, awaiting owner's final "ja"
  to push. Local HEAD is 5 commits ahead of origin/main: 5cc9a6a (round-2
  idempotency fix), d523db6 (#6), bb140a3 (#5 + quorum build_title fix +
  backfill script), dad1423 (state), 324e76a (astro-check type fix).

ROUND 3 RECAP:
  #6 (static Astro.redirect() -> real 301/302): DONE. New
    resolveStaticGateRedirect() in site/server/_shared.ts, wired into
    worker.ts right after the existing /this-week/ block (identical root
    cause/fix pattern). Covers all 14 live-broken routes across all 3
    towns; whats-on excluded (hasWhatsOn true everywhere today, never
    redirects). .astro pages' own Astro.redirect() calls untouched
    (still correct for local `astro dev`).

  #5 (duplicate <title> tags): DONE. New titleTagForStory()/
    formatShortMonthDay() in db.ts, wired into s/[slug].astro's
    BaseLayout title prop ONLY (never H1/story.title/JSON-LD). Scoped to
    event+alert per owner approval after I surfaced the alert case (50
    stories) during investigation -- originally asked about events only.

  #5 SIDE FIX: ai_pipeline/publish.py's build_title() quorum-notice
    branch never appended the meeting date (regular meetings' own
    fallback branch does) -- fixed to match.

  #5 BACKFILL: RAN, 23 of 28 quorum-notice titles updated (title column
    only). 5 intentionally skipped and left untouched -- their
    meetings' raw_data.agenda_text is now NULL (see "OPEN ISSUE" below),
    which would make re-running the classifier mislabel them as generic
    "City Council" meetings instead of fixing the date. Confirmed live
    in DB and in a built page (grep'd dist output) before cleanup.

  POST-HOC BUG CAUGHT: db.test.ts's new titleTagForStory fixture typed
    source_type as bare `string` -- astro check caught it (5 errors),
    fixed by typing it as the real SourceType union (324e76a).

  BUILD INFRASTRUCTURE NOTE (this session): discovered the `| tail -N`
    pattern used for background astro builds all session silently
    discards the REAL process exit code (bash reports the pipe's last
    command's exit status, i.e. tail's, always 0) -- a transient Neon
    "fetch failed" mid-build on the first Moreno Valley rebuild attempt
    went undetected until I happened to read the tail output's content
    rather than trust the reported exit code. Switched to `> file 2>&1;
    echo "REAL EXIT CODE: $?" >> file` for the rest of this round.
    Rebuilt clean on retry (transient, not a code bug). Worth carrying
    this redirection pattern into future sessions' builds too.

PRE-PUSH VERIFICATION (all green, this session, after backfill + fix):
  - pytest: 871 passed, 8 skipped (unchanged -- backfill ran as a one-off).
  - vitest: 1051 passed, 51 files.
  - astro check: 0 errors (was 5, fixed in 324e76a), 0 warnings.
  - astro build all 3 towns (real exit codes checked, not piped through
    tail): brookings_sd 636 pages, moreno_valley_ca 3407 pages,
    broomfield_co 1078 pages. Broomfield has 3 pre-existing CSS esbuild
    warnings (css-syntax-error, unrelated to anything touched this
    session) -- not new, build still succeeds.
  - scripts/verify_sitemap_noindex_disjoint.mjs: OK on all 3 (107/140/80
    URLs, zero offenders). Temp dist-*/build-log files removed after.

NEXT STEP: push the 5 commits above after owner's explicit "ja".

OPEN ISSUE, flagged this round, NOT fixed (separate from today's asks):
  Legistar raw_data-overwrite data loss. 5 known-affected meeting_ids
  (1314, 2428, 10973, 11006, 11009, all brookings_sd) now have raw_data.
  agenda_text = NULL even though they clearly had real agenda content
  when first scraped (their stories' original titles proved it).
  Root cause: a later Legistar rescrape of a sufficiently old EventId can
  return zero agenda items, and legistar_v1.py's upsert REPLACES raw_data
  wholesale (update_columns includes "raw_data") rather than merging --
  overwriting richer historical content with an impoverished version.
  Likely affects more meetings over time as others age past whatever
  threshold triggers Legistar to stop serving item-level detail. Not
  scheduled for any round yet.

REMAINING QA FINDINGS, not yet scheduled: #9 (Celebration Park hours,
  Moreno Valley, unverified/info-only -- lowest priority, info-only per
  the original report).
