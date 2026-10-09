/** Build-time safety net -- see handoff "Broomfield has no hero image and
 *  no inline article images" (Phase 3) and its follow-up "Build check for
 *  the article / content-track image tier". Three independent checks, all
 *  fail the build loudly by design (a whole town silently missing image/
 *  venue-matching coverage is exactly the failure mode none of them ever
 *  surfaced on its own until diagnosed by hand):
 *
 *    1. Every category this town's enabled features actually need has a
 *       non-empty photo pool -- see images.ts's assertCategoryImagesComplete().
 *    2. Venue-based image matching is actually REACHABLE for this town, not
 *       just "some aliases exist" -- see assertVenueMatchingReachable()'s
 *       own comment for why the aliases-only version of this check was
 *       real, dangerous false confidence: Broomfield has two genuine,
 *       evidence-based aliases seeded (see scripts/
 *       seed_facility_name_aliases.py) and the venue tier is STILL
 *       structurally dead there, because no story carries the venue_raw
 *       signal those aliases would need to match against. An
 *       aliases-only check goes green on exactly the town it exists to
 *       catch.
 *    3. Every content-track story (recipe, editorial, culture essay,
 *       science column, review) actually has an image on disk -- see
 *       assertContentTrackImagesComplete() below. These types resolve
 *       through the article-image tier alone (story.image_path, written by
 *       the Flux/fal pipeline at publish time) and have NO category
 *       fallback by design, so a failed generation is a PERMANENT gap for
 *       that specific item, silent until this check existed.
 *    4. page_meta_check (assertPageMetaPatternsValid() below): the sitewide
 *       title/H1/lede handoff's own validation phase. This is the SAME
 *       "build-time, fails loud" mechanism, not the Python validation/
 *       package the handoff originally assumed -- that package validates
 *       AI content before publish and has zero visibility into built Astro
 *       HTML (see NEEDS-HUMAN-REVIEW.md #48).
 *
 *  Called once from BaseLayout.astro (every real page renders it), guarded
 *  by a module-level flag so a build with hundreds of pages only actually
 *  runs the DB query once, not once per page. Never called at module
 *  import time and never imported by a vitest test -- `astro check` never
 *  executes this file at all (pure type-checking, no runtime), and vitest
 *  has no reason to import it, so neither needs DATABASE_URL just to run.
 */
import { TOWN_ID, getFacilities, hasAnyStoryWithVenueRaw, getContentTrackImageStatus, getAllWeeklyStories, getPlaceGuardrailData, getSandboxSourceUrlSlugs } from './db';
import { siteConfig } from './site-config';
import { categoryImagesFor } from '../config/category-images';
import { assertCategoryImagesComplete, assertImageExists, findContentTrackRowsMissingImage } from './images';
import { PAGE_META_PATTERNS } from '../config/page-meta';
import { isPastStalenessThreshold } from './place-hours';
import { resolvePageMeta } from './page-meta';
import { facilityTitleElements } from './facility-lede';
import { weekInfoForInstant, currentWeekInfo } from './this-week';
import { localDateParts } from './events';
import {
  weeksCoverage, forwardCoverageWeeks, seasonPoolSizes, MIN_POOL_SIZE_FOR_60_DAY_RULE, RECOMMENDED_MIN_POOL_SIZE,
  type WeekCoverage, type SeasonPoolSize,
} from './this-week-images';
import { THIS_WEEK_IMAGES } from '../config/this-week-images';
import { holidayPoolSizesDueSoon, holidayPoolSizeForWeek as _holidayPoolSizeForWeek, type DateYMD } from './holidays';
import { HOLIDAYS, HOLIDAY_IMAGES } from '../config/holidays';

let checked = false;

/** Known, explicitly-tracked exception: Broomfield's AgendaLink meetings
 *  carry a real room/address in their raw scrape data (meetings.raw_data
 *  ->'room'), but ai_pipeline/publish.py doesn't yet surface that into
 *  stories.venue_raw for AgendaLink-sourced meetings -- so venue-based
 *  image matching is genuinely still dead here even though real aliases
 *  are seeded (scripts/seed_facility_name_aliases.py). That publish.py fix
 *  touches the shared, cross-town publish pipeline and needs its own
 *  regression check, so it's deliberately a SEPARATE task, not folded into
 *  this image-sourcing pass. Rather than hard-failing every Broomfield
 *  build (and its next scheduled deploy) until that separate task lands,
 *  this town gets a loud, un-missable WARNING instead of a throw -- see
 *  assertVenueMatchingReachable() below.
 *
 *  EACH ENTRY HAS AN EXPIRY DATE ('YYYY-MM-DD'), on purpose: a warning
 *  printed on every build stops actually being read after a couple of
 *  weeks (see the discussion that added this), and a named exception with
 *  no expiry quietly becomes permanent -- nobody revisits a build that's
 *  passing, even loudly. Once today is past the date, this town's build
 *  starts hard-FAILING instead of warning, forcing an active decision:
 *  either the underlying gap is actually fixed (remove the entry -- the
 *  assert then auto-enforces with no other change needed), or someone
 *  deliberately re-reviews and pushes the date out, which is a real,
 *  visible decision in a diff, not silence. Never bump the date "to make
 *  the build pass" without that re-review actually happening. */
const KNOWN_VENUE_MATCHING_GAPS: Record<string, string> = {
  broomfield_co: '2026-11-28', // ~3 months from 2026-08-28 -- see the publish.py venue_raw task
};

/** Same dated-exception shape as KNOWN_VENUE_MATCHING_GAPS above, for
 *  assertNoSandboxSourceUrls(): confirmed live 2026-09-30 that 24 already-
 *  published Broomfield stories carry a sandbox.agendalink.app source_url
 *  from before every render site was gated on isSandboxUrl() -- a real,
 *  known, already-existing gap (not a hypothetical this check invents), not
 *  yet backfilled pending an explicit go-ahead (a DB write to already-
 *  published rows, deliberately not done without one -- see
 *  scripts/backfill_sandbox_source_urls.py, not yet run). Warn until fixed;
 *  expires so this can't quietly become permanent. */
const KNOWN_SANDBOX_URL_GAP_EXPIRY = '2026-10-31';

/** Requires BOTH a real alias and a real venue_raw signal to match it
 *  against -- either alone can be true while the venue tier is still dead
 *  in practice (see KNOWN_VENUE_MATCHING_GAPS above for exactly this
 *  happening to Broomfield). Known limitation, stated plainly rather than
 *  silently assumed away: this can't detect a town that matches PURELY via
 *  title-prefix with literally zero venue_raw ever (Moreno Valley's
 *  library branches lean on title-prefix) -- not a real gap today, since
 *  every currently-known working town also carries substantial venue_raw
 *  (Brookings 93/318 stories, Moreno Valley 1062/1221, checked live
 *  2026-08-28), but a future town could in principle be title-prefix-only
 *  and still legitimately pass zero venue_raw. Revisit if that ever
 *  actually happens, not speculatively now. */
async function assertVenueMatchingReachable(): Promise<void> {
  const facilities = await getFacilities();
  if (facilities.length === 0) return; // nothing seeded yet -- not this check's job

  const anyAliased = facilities.some((f) => f.name_aliases.length > 0);
  const hasVenueRaw = await hasAnyStoryWithVenueRaw();

  const problems: string[] = [];
  if (!anyAliased) problems.push('all facilities have zero name_aliases');
  if (!hasVenueRaw) problems.push('no story has a non-empty venue_raw (the alias-matching input signal itself is missing)');

  if (problems.length === 0) return;

  const message = `venue-based image matching is structurally dead for "${TOWN_ID}" -- ${problems.join('; ')}.`;
  const expiry = KNOWN_VENUE_MATCHING_GAPS[TOWN_ID];

  if (expiry && new Date() <= new Date(expiry)) {
    console.warn(
      `\n⚠️  KNOWN GAP (tracked, not build-blocking until ${expiry}): ${message}\n` +
      '   See build-checks.ts\'s KNOWN_VENUE_MATCHING_GAPS comment and the separate ' +
      'publish.py venue_raw task to close this for real.\n',
    );
    return;
  }

  if (expiry) {
    throw new Error(
      `Build-time facility check failed: ${message} The KNOWN_VENUE_MATCHING_GAPS exception ` +
      `for "${TOWN_ID}" expired on ${expiry} -- either close the underlying gap (remove the ` +
      'entry, the assert then auto-enforces) or deliberately re-review and push the date out ' +
      'in build-checks.ts, never just to silence this build.',
    );
  }

  throw new Error(
    `Build-time facility check failed: ${message} See scripts/seed_facility_name_aliases.py ` +
    'and lib/images.ts\'s resolveVenueSlugForImage().',
  );
}

/** No known-exception mechanism here, unlike assertVenueMatchingReachable()
 *  above -- a missing content-track image has no "not fully wired up yet"
 *  excuse the way Broomfield's venue_raw gap does; it's either a real
 *  generation failure (see scripts/backfill_content_track_image.py to fix
 *  it directly, without a full article regeneration) or a path pointing at
 *  a file that never made it into the build output. Both are always
 *  actionable, so both always hard-fail. */
async function assertContentTrackImagesComplete(): Promise<void> {
  const rows = await getContentTrackImageStatus();

  const missing = findContentTrackRowsMissingImage(rows);
  if (missing.length > 0) {
    const list = missing.map((r) => `${TOWN_ID}/${r.slug} (${r.source_type})`).join(', ');
    throw new Error(
      `Build-time content-track image check failed: ${missing.length} row(s) with no image_path -- ` +
      `${list}. Content-track types have no category fallback -- see ` +
      'scripts/backfill_content_track_image.py to regenerate just the illustration for an existing story.',
    );
  }

  // Column is non-null for every row at this point -- also confirm the file
  // it names actually reached the build output, not just that the DB thinks
  // it exists. Reuses the SAME check resolveImage() itself uses at render
  // time (assertImageExists), just called here proactively for every row
  // instead of only the one a page happens to render.
  for (const row of rows) {
    assertImageExists(row.image_path as string, `${TOWN_ID}/${row.slug} (${row.source_type})`);
  }
}

const TITLE_MAX_LENGTH = 65;
const MIN_H1_WORDS = 4;
const MAX_TITLE_H1_SIMILARITY = 0.8;

/** Route keys resolvePageMeta() can't resolve without extraVars -- handled
 *  by their own dedicated, real-instance-driven checks below instead of
 *  the generic per-town sweep. */
const EXTRA_VAR_ROUTE_KEYS = new Set(['facilities/detail', 'this-week']);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Rough, deliberately simple word-overlap similarity -- enough to catch a
 *  title that's just the H1 with "| {Site}" trimmed off (or vice versa),
 *  which would defeat the point of having two distinct fields at all. Not
 *  meant to be a general string-similarity library. */
function titleH1Similarity(title: string, h1: string): number {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const a = words(title);
  const b = words(h1);
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** A week label straddling a calendar year (e.g. "December 29, 2025 -
 *  January 4, 2026") is the one documented, unavoidable length exception
 *  for the this-week route -- see config/page-meta.ts's own comment on
 *  that entry. Detected off the label text itself (two distinct 4-digit
 *  years) rather than re-deriving it from the week's start/end dates,
 *  since the label is the actual thing being measured. */
function crossesCalendarYear(weekLabel: string): boolean {
  const years = new Set(weekLabel.match(/\b(19|20)\d{2}\b/g) ?? []);
  return years.size >= 2;
}

function checkResolved(
  routeKey: string, instance: string, title: string, h1: string, knownLengthException: boolean,
  problems: string[],
): void {
  if (title.length > TITLE_MAX_LENGTH) {
    const msg = `${routeKey} ${instance}: title is ${title.length} chars (max ${TITLE_MAX_LENGTH}) -- "${title}"`;
    if (knownLengthException) {
      console.warn(`\n⚠️  page_meta_check: known, documented length exception -- ${msg}\n`);
    } else {
      problems.push(msg);
    }
  }
  if (!h1.trim()) {
    problems.push(`${routeKey} ${instance}: H1 is empty`);
  } else if (wordCount(h1) < MIN_H1_WORDS) {
    problems.push(`${routeKey} ${instance}: H1 is only ${wordCount(h1)} word(s) (min ${MIN_H1_WORDS}) -- "${h1}"`);
  }
  const similarity = titleH1Similarity(title, h1);
  if (similarity > MAX_TITLE_H1_SIMILARITY) {
    problems.push(
      `${routeKey} ${instance}: title and H1 share ${Math.round(similarity * 100)}% of their words, ` +
      `not distinct fields -- title "${title}", h1 "${h1}"`,
    );
  }
}

/** Build-time validation for the sitewide title/H1/lede handoff's own
 *  config catalog (config/page-meta.ts) -- the check the handoff's own
 *  "Order of work" calls for AFTER every template is migrated to
 *  resolvePageMeta(). Deliberately validates the catalog plus real
 *  per-instance DB data (facility names, real ISO weeks), not scraped
 *  dist/ HTML: this file's own existing checks (assertCategoryImagesComplete
 *  et al, above) already establish that "build-time, fails loud" here means
 *  querying the same data the pages render from and asserting on it
 *  directly, not re-parsing rendered output.
 *
 *  DELIBERATELY SCOPED OUT for v1: the handoff's own "lede >= 20 words on
 *  an indexable page" rule. Every migrated page's lede is still
 *  hand-written prose living directly in that page's own JSX (per the
 *  handoff's own "ledes stay in content, not config" instruction) -- there
 *  is no config or DB signal this check can read to find that text without
 *  every page ALSO threading its rendered lede string back through
 *  BaseLayout, which is a real, separate plumbing task, not a natural
 *  extension of this one. Flagged in NEEDS-HUMAN-REVIEW.md as a named,
 *  known gap rather than silently skipped. */
async function assertPageMetaPatternsValid(): Promise<void> {
  const problems: string[] = [];
  const titleOwners = new Map<string, string>(); // resolved title -> "routeKey instance" that first claimed it

  const recordTitle = (routeKey: string, instance: string, title: string) => {
    const existing = titleOwners.get(title);
    if (existing) {
      problems.push(`duplicate title within "${TOWN_ID}": "${title}" used by both ${existing} and ${routeKey} ${instance}`);
    } else {
      titleOwners.set(title, `${routeKey} ${instance}`);
    }
  };

  for (const routeKey of Object.keys(PAGE_META_PATTERNS)) {
    if (EXTRA_VAR_ROUTE_KEYS.has(routeKey)) continue;
    const { title, h1 } = resolvePageMeta(routeKey, siteConfig);
    checkResolved(routeKey, '(static)', title, h1, false, problems);
    recordTitle(routeKey, '(static)', title);
  }

  // facilities/detail: the known, unavoidable length exception (see
  // config/page-meta.ts's own comment on this entry) -- warn, don't throw,
  // on overflow. Still enforced: non-empty/adequate H1, and no two
  // facilities resolving to the identical title (which WOULD be a real
  // bug -- two facilities can't legitimately share a name).
  const facilities = await getFacilities();
  for (const facility of facilities) {
    // Phase 2, item 2f (2026-10-09): mirrors facilities/[slug].astro's own
    // Elements computation, with one deliberate simplification -- checks
    // `hours_text` only, not the real structured `place_hours` rows (that
    // would mean an extra DB query per facility in this sweep over EVERY
    // facility across the town). Safe here specifically: this route is
    // already `knownLengthException: true` (a warning, not a hard failure,
    // on overflow -- see checkResolved's own doc), so under-counting
    // "has hours" only ever UNDER-estimates this check's title length,
    // never silently hides a real duplicate-title bug (the other thing
    // this loop catches, unaffected by Elements at all).
    const elements = facilityTitleElements(Boolean(facility.hours_text), Boolean(facility.address), Boolean(facility.phone));
    const { title, h1 } = resolvePageMeta('facilities/detail', siteConfig, { FacilityName: facility.name, Elements: elements });
    checkResolved('facilities/detail', facility.slug, title, h1, true, problems);
    recordTitle('facilities/detail', facility.slug, title);
  }

  // this-week: the second known length exception is the one real week a
  // year that crosses a calendar-year boundary (see config/page-meta.ts).
  // Real weeks only, mirroring this-week/[week].astro's own getStaticPaths
  // -- every weekly story ever published, plus the current "week ahead".
  const weeklyStories = await getAllWeeklyStories();
  const weekLabels = new Map<string, string>(); // slug -> label
  for (const story of weeklyStories) {
    if (!story.occurs_at) continue;
    const info = weekInfoForInstant(new Date(story.occurs_at), siteConfig.timezone);
    weekLabels.set(info.slug, info.label);
  }
  const current = currentWeekInfo(siteConfig.timezone);
  weekLabels.set(current.slug, current.label);
  for (const [slug, label] of weekLabels) {
    const { title, h1 } = resolvePageMeta('this-week', siteConfig, { WeekLabel: label });
    checkResolved('this-week', slug, title, h1, crossesCalendarYear(label), problems);
    recordTitle('this-week', slug, title);
  }

  if (problems.length > 0) {
    throw new Error(
      `Build-time page_meta_check failed for "${TOWN_ID}" (${problems.length} problem(s)):\n` +
      problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
}

/** Broomfield place-layer handoff, Section 8 ("Guardrails / build-fails-
 *  loud"). Two real, throwing checks -- both genuine failure modes a bad
 *  seed edit could actually introduce:
 *    1. hours_confidence='structured' but zero place_hours rows -- the
 *       page would silently render "hours not confirmed" while the DB
 *       claims otherwise, or worse, JSON-LD's own emitHoursSchema gate
 *       (place/[slug].astro) would just correctly emit nothing, masking
 *       the real data-entry mistake instead of surfacing it.
 *    2. Missing source_url or verified_date -- the handoff's own hard
 *       rule ("source_url and last_verified_at required on every row").
 *  Plus one WARN, not throw, per the handoff's own explicit instruction
 *  ("warn, do not fail, on any place past its staleness threshold, and
 *  list them so the queue is visible") -- staleness is an expected,
 *  eventual state for any real place, not a data-entry mistake.
 *
 *  The spec's third throwing guardrail ("an exception row has a date in
 *  the past... and is still being rendered") is NOT implemented as a
 *  separate runtime check here -- it's structurally impossible by
 *  construction: getUpcomingPlaceHoursExceptions() (lib/db.ts) only ever
 *  selects `date >= CURRENT_DATE`, so no code path in this codebase can
 *  render a past exception regardless of how long one sits in the table.
 *  Writing a redundant check against an unreachable state would be dead
 *  code asserting nothing real.
 *
 *  The spec's validation-package guardrail ("no LLM-written text on a
 *  place page may contain a time, date, phone number, or address") has no
 *  current target either -- /place/[slug].astro and /places/index.astro
 *  render zero LLM-written text today (every fact is a column value; the
 *  index page's own "teaser" is a deterministic, non-AI string built from
 *  category + open-status, see places/index.astro's own comment). Nothing
 *  to check yet; revisit if an AI-generated place description is ever
 *  actually introduced. */
async function assertPlaceLayerConsistent(): Promise<void> {
  if (!siteConfig.hasPlaces) return;

  const rows = await getPlaceGuardrailData();
  const problems: string[] = [];
  const staleHours: string[] = [];
  const staleAddress: string[] = [];
  const staleness = siteConfig.placeStaleness ?? { hoursDays: 45, addressPhoneDays: 180 };
  const now = new Date();

  for (const row of rows) {
    if (row.hours_confidence === 'structured' && row.place_hours_count === 0) {
      problems.push(`${row.slug}: hours_confidence='structured' but has zero place_hours rows`);
    }
    if (!row.source_url) problems.push(`${row.slug}: missing source_url`);
    if (!row.verified_date) problems.push(`${row.slug}: missing verified_date`);
    // Hours age faster than address/phone -- two thresholds, not one, per
    // the handoff's own suggested defaults (45 vs 180 days). Only checked
    // for a place that actually claims structured hours; a place with no
    // hours data at all has nothing hours-specific to go stale.
    if (row.hours_confidence === 'structured' && isPastStalenessThreshold(row.verified_date, staleness.hoursDays, now)) {
      staleHours.push(`${row.slug}: hours last verified ${row.verified_date ?? 'never'} (> ${staleness.hoursDays} days)`);
    }
    if (isPastStalenessThreshold(row.verified_date, staleness.addressPhoneDays, now)) {
      staleAddress.push(`${row.slug}: address/phone last verified ${row.verified_date ?? 'never'} (> ${staleness.addressPhoneDays} days)`);
    }
  }

  if (staleHours.length > 0 || staleAddress.length > 0) {
    console.warn(
      `\n⚠️  Place-layer staleness queue for "${TOWN_ID}" -- render as "Last confirmed <date>", never hidden:\n` +
      (staleHours.length > 0 ? `  Hours (> ${staleness.hoursDays}d):\n` + staleHours.map((s) => `   - ${s}`).join('\n') + '\n' : '') +
      (staleAddress.length > 0 ? `  Address/phone (> ${staleness.addressPhoneDays}d):\n` + staleAddress.map((s) => `   - ${s}`).join('\n') + '\n' : ''),
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Build-time place-layer check failed for "${TOWN_ID}" (${problems.length} problem(s)):\n` +
      problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
}

/** Broomfield Handoff (2026-09-30), Issue 2: AgendaLink's own API returns
 *  `agendaUrl` values pointing at sandbox.agendalink.app, not a confirmed
 *  production host (see db.ts's isSandboxUrl() comment for the full
 *  investigation) -- every render site now gates on isSandboxUrl() instead
 *  of emitting it, but this proactively queries stories.source_url directly
 *  so a future render site that forgets that gate fails the build loudly
 *  instead of silently shipping a sandbox link to production. */
async function assertNoSandboxSourceUrls(): Promise<void> {
  const slugs = await getSandboxSourceUrlSlugs();
  if (slugs.length === 0) return;

  const message = `${slugs.length} stor${slugs.length === 1 ? 'y' : 'ies'} in "${TOWN_ID}" still ` +
    `carr${slugs.length === 1 ? 'ies' : 'y'} a sandbox.* source_url: ${slugs.join(', ')}.`;

  if (new Date() <= new Date(KNOWN_SANDBOX_URL_GAP_EXPIRY)) {
    console.warn(
      `\n⚠️  KNOWN GAP (tracked, not build-blocking until ${KNOWN_SANDBOX_URL_GAP_EXPIRY}): ${message}\n` +
      '   Every render site already gates on isSandboxUrl() so none of these reach published output, ' +
      'but the rows themselves are unbackfilled -- see build-checks.ts\'s KNOWN_SANDBOX_URL_GAP_EXPIRY comment.\n',
    );
    return;
  }

  throw new Error(
    `Build-time sandbox-URL check failed: ${message} The KNOWN_SANDBOX_URL_GAP_EXPIRY exception expired on ` +
    `${KNOWN_SANDBOX_URL_GAP_EXPIRY} -- either backfill these rows or deliberately re-review and push the date out.`,
  );
}

const THIS_WEEK_IMAGE_COVERAGE_HORIZON_WEEKS = 8;
const THIS_WEEK_IMAGE_COVERAGE_WARN_THRESHOLD = 4;
const THIS_WEEK_IMAGE_COVERAGE_FAIL_THRESHOLD = 1;

function describeCoverage(coverage: WeekCoverage[]): string {
  return coverage.map((w) => `${w.isoYearWeek} (${w.season}): ${w.poolSize} image(s)`).join(', ');
}

/** `holidayPoolSizeForWeek()` bound to this town's HOLIDAYS/HOLIDAY_IMAGES --
 *  the actual logic (and its 2026-10-07 "holiday-blind" backstory) lives in
 *  lib/holidays.ts, tested directly there (holidays.test.ts) since
 *  build-checks.ts itself can't be imported under vitest (db.ts calls
 *  neon(import.meta.env.DATABASE_URL) at module load). Shared by both the
 *  per-week coverage check and the season-pool-size check below, so a
 *  week/moment the real rotation would actually serve from the holiday
 *  pool never gets blamed on an empty season pool it was never going to
 *  use. */
function holidayPoolSizeForWeek(monday: DateYMD, sunday: DateYMD): number {
  return _holidayPoolSizeForWeek(HOLIDAYS, HOLIDAY_IMAGES, TOWN_ID, monday, sunday);
}

/** "This week" image pool, forward-looking coverage guardrail -- see
 *  lib/this-week-images.ts's weeksCoverage()/forwardCoverageWeeks() for the
 *  pure pool-only math this wraps. Deliberately NOT a duplicate of db.ts's
 *  resolveThisWeekImage() own per-week throw (kept as-is, unchanged): that
 *  one additionally accounts for the live 60-day no-repeat usage history
 *  from the DB, so it's the authoritative check for whether THIS week's
 *  build will actually succeed. This check is a cheaper, static radar with
 *  no DB dependency that catches an empty pool for an UPCOMING season weeks
 *  before the rotation actually reaches it -- not a simulation of the real
 *  rotation (it ignores usage history entirely, so it can under-count a
 *  real future gap caused by every pool entry having been recently shown,
 *  and over-count... never: a pool-level zero is always a real zero).
 *
 *  Each week's poolSize is the SEASON pool size, overridden with the
 *  HOLIDAY pool size whenever an active holiday with a non-empty pool
 *  covers that week (2026-10-07 review: this check used to be entirely
 *  holiday-blind, so e.g. w50-w52 with an empty winter season pool would
 *  throw here even while fully covered by an already-applied Christmas
 *  pool -- caught by simulating Dec 7 2026 against the real pools before
 *  this fix). See holidayPoolSizeForWeek() above for exactly which case
 *  that is.
 *
 *  WARN when fewer than THIS_WEEK_IMAGE_COVERAGE_WARN_THRESHOLD consecutive
 *  weeks (starting THIS week) have at least one eligible image -- enough
 *  runway to add more curated images (scripts/source_this_week_images.py)
 *  before it becomes a real failure.
 *
 *  THROW when fewer than THIS_WEEK_IMAGE_COVERAGE_FAIL_THRESHOLD -- i.e. the
 *  CURRENT week's own pool is already empty. db.ts's resolveThisWeekImage()
 *  would fail the build anyway once WeeklyRoundup.astro actually renders,
 *  but this throws earlier, with the full forward picture already in the
 *  message, rather than waiting for that render to happen. */
function assertThisWeekImageCoverage(): void {
  const now = new Date();
  const weekInfos = Array.from({ length: THIS_WEEK_IMAGE_COVERAGE_HORIZON_WEEKS }, (_, i) =>
    weekInfoForInstant(new Date(now.getTime() + i * 7 * 86_400_000), siteConfig.timezone));
  const seasonCoverage = weeksCoverage(
    THIS_WEEK_IMAGES, TOWN_ID,
    weekInfos.map((info) => ({ isoYearWeek: info.slug, month: info.monday.m })),
  );
  const coverage: WeekCoverage[] = seasonCoverage.map((week, i) => {
    const holidaySize = holidayPoolSizeForWeek(weekInfos[i].monday, weekInfos[i].sunday);
    return holidaySize > 0 ? { ...week, poolSize: holidaySize } : week;
  });
  const forward = forwardCoverageWeeks(coverage);

  if (forward < THIS_WEEK_IMAGE_COVERAGE_FAIL_THRESHOLD) {
    throw new Error(
      `Build-time "This week" image coverage check failed for "${TOWN_ID}": the CURRENT week ` +
      `(${coverage[0].isoYearWeek}, ${coverage[0].season}) has zero eligible images in ` +
      `config/this-week-images.ts. Next ${THIS_WEEK_IMAGE_COVERAGE_HORIZON_WEEKS} weeks: ${describeCoverage(coverage)}. ` +
      'Add curated images via scripts/source_this_week_images.py before this town can build.',
    );
  }

  if (forward < THIS_WEEK_IMAGE_COVERAGE_WARN_THRESHOLD) {
    console.warn(
      `\n⚠️  "This week" image coverage for "${TOWN_ID}" runs out in ${forward} week(s) ` +
      `(warn threshold: ${THIS_WEEK_IMAGE_COVERAGE_WARN_THRESHOLD}). Next ` +
      `${THIS_WEEK_IMAGE_COVERAGE_HORIZON_WEEKS} weeks: ${describeCoverage(coverage)}. Add more curated images via ` +
      'scripts/source_this_week_images.py before the rotation actually reaches the empty week(s).\n',
    );
  }

  assertThisWeekSeasonPoolSizes(now);
  assertHolidayPoolSizes(now);
}

const SEASON_POOL_SHIFT_WARNING_DAYS = 30;

function describeSeasonPools(sizes: SeasonPoolSize[]): string {
  return sizes.map((s) => `${s.scope} season "${s.season}": ${s.poolSize} image(s)`).join('; ');
}

/** Per-town pool-SIZE guardrail, independent of weeksCoverage() above (which
 *  only ever asks "is this week's pool non-empty", never "is it big
 *  enough"): a pool of, say, 3 images passes weeksCoverage() for every one
 *  of the next 8 weeks (each week's own check only sees ">0"), yet the real
 *  60-day no-repeat rule guarantees that same handful of images will start
 *  repeating inside 60 days, every time, forever -- see lib/this-week-
 *  images.ts's MIN_POOL_SIZE_FOR_60_DAY_RULE for exactly why 9 is the
 *  structural floor. Checks the CURRENT season always, and the NEXT season
 *  too once today is within SEASON_POOL_SHIFT_WARNING_DAYS of its start
 *  date -- see seasonPoolSizes()'s own comment for why that's worth doing
 *  ahead of weeksCoverage() ever reaching that boundary itself.
 *
 *  THROW below MIN_POOL_SIZE_FOR_60_DAY_RULE (9) -- the 60-day rule cannot
 *  be upheld indefinitely at this size, regardless of usage history. BUT
 *  only for the 'current' scope when the week happening RIGHT NOW isn't
 *  already covered by an active, non-empty holiday pool (holidayPoolSizeForWeek()
 *  above) -- otherwise this threw on an empty winter season pool throughout
 *  the Dec 11-25 Christmas window even though that window's own pool was
 *  already covering every one of those weeks (2026-10-07 review, same
 *  diagnosis as assertThisWeekImageCoverage() above). Still WARNS in that
 *  case, since the season pool genuinely will be needed the moment the
 *  holiday window ends -- just doesn't hard-fail a build that would
 *  actually succeed today. The 'next'-scope entry (the season-shift
 *  warning) is a season that hasn't started yet by definition, so it's
 *  never holiday-covered and always throws/warns normally.
 *  WARN below RECOMMENDED_MIN_POOL_SIZE (13) -- the brief's own stated
 *  minimum (see config/this-week-images.ts's module comment); mechanically
 *  sustainable but thinner variety than intended. */
function assertThisWeekSeasonPoolSizes(now: Date): void {
  const today = localDateParts(now, siteConfig.timezone);
  const sizes = seasonPoolSizes(THIS_WEEK_IMAGES, TOWN_ID, today.m, today.d, SEASON_POOL_SHIFT_WARNING_DAYS);

  const thisWeek = weekInfoForInstant(now, siteConfig.timezone);
  const holidayCoversNow = holidayPoolSizeForWeek(thisWeek.monday, thisWeek.sunday) > 0;

  const tooSmall = sizes.filter((s) => s.poolSize < MIN_POOL_SIZE_FOR_60_DAY_RULE);
  const mustThrow = tooSmall.filter((s) => !(s.scope === 'current' && holidayCoversNow));
  if (mustThrow.length > 0) {
    throw new Error(
      `Build-time "This week" image pool-size check failed for "${TOWN_ID}": ${describeSeasonPools(mustThrow)} -- ` +
      `below the structural minimum of ${MIN_POOL_SIZE_FOR_60_DAY_RULE} (the 60-day no-repeat rule cannot be ` +
      'upheld indefinitely at this size, regardless of usage history). Add curated images via ' +
      'scripts/source_this_week_images.py.',
    );
  }
  const suppressed = tooSmall.filter((s) => s.scope === 'current' && holidayCoversNow);
  if (suppressed.length > 0) {
    console.warn(
      `\n⚠️  "This week" image pool for "${TOWN_ID}" is below the structural minimum of ` +
      `${MIN_POOL_SIZE_FOR_60_DAY_RULE} (${describeSeasonPools(suppressed)}), not failing the build because the ` +
      `current week is already covered by an active holiday pool -- but this will be needed the moment that ` +
      'window ends. Add curated images via scripts/source_this_week_images.py.\n',
    );
  }

  const belowRecommended = sizes.filter((s) => s.poolSize < RECOMMENDED_MIN_POOL_SIZE);
  if (belowRecommended.length > 0) {
    console.warn(
      `\n⚠️  "This week" image pool for "${TOWN_ID}" is below the recommended minimum of ` +
      `${RECOMMENDED_MIN_POOL_SIZE}: ${describeSeasonPools(belowRecommended)}. Add more curated images via ` +
      'scripts/source_this_week_images.py.\n',
    );
  }
}

const HOLIDAY_WINDOW_WARNING_DAYS = 30;
const HOLIDAY_MIN_POOL_SIZE = 3;

/** Holiday equivalent of assertThisWeekSeasonPoolSizes() above -- WARN only
 *  (2026-10-06 review instruction: "byggvarning", not a build-failing
 *  check -- a thin or still-empty holiday pool is expected right up until
 *  curation finishes, not a data-entry mistake the way an empty SEASON
 *  pool would be) when today falls within HOLIDAY_WINDOW_WARNING_DAYS of
 *  an ACTIVE holiday's own window start and this town's pool for it has
 *  fewer than HOLIDAY_MIN_POOL_SIZE images. Inactive holidays (every
 *  Level-2 entry in config/holidays.ts today) are never checked at all --
 *  same as the real week-resolver, which never looks at an inactive
 *  holiday's pool either. */
function assertHolidayPoolSizes(now: Date): void {
  const today = localDateParts(now, siteConfig.timezone);
  const dueSoon = holidayPoolSizesDueSoon(HOLIDAYS, HOLIDAY_IMAGES, TOWN_ID, today, HOLIDAY_WINDOW_WARNING_DAYS);
  const tooSmall = dueSoon.filter((c) => c.poolSize < HOLIDAY_MIN_POOL_SIZE);
  if (tooSmall.length === 0) return;

  console.warn(
    `\n⚠️  Holiday image pool for "${TOWN_ID}" is below the minimum of ${HOLIDAY_MIN_POOL_SIZE} with its ` +
    `window approaching: ${tooSmall.map((c) => `${c.holiday} (window starts ${c.windowStart.y}-${c.windowStart.m}-${c.windowStart.d}): ${c.poolSize} image(s)`).join('; ')}. ` +
    'Add curated images via scripts/source_this_week_images.py --holiday <name>.\n',
  );
}

/** Renamed from runBuildTimeImageChecks: this single build-time hook (still
 *  called once from BaseLayout.astro, still guarded by the same module-level
 *  `checked` flag) now also runs page_meta_check -- see
 *  assertPageMetaPatternsValid() above for why that belongs here rather
 *  than the Python validation/ package (NEEDS-HUMAN-REVIEW.md #48) -- and
 *  the Broomfield place-layer handoff's own Section 8 guardrails. */
export async function runBuildTimeChecks(): Promise<void> {
  if (checked) return;
  checked = true;
  assertCategoryImagesComplete(siteConfig, categoryImagesFor(siteConfig.townId));
  await assertVenueMatchingReachable();
  await assertContentTrackImagesComplete();
  await assertPageMetaPatternsValid();
  await assertPlaceLayerConsistent();
  await assertNoSandboxSourceUrls();
  assertThisWeekImageCoverage();
}
