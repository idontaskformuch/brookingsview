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
import { TOWN_ID, getFacilities, hasAnyStoryWithVenueRaw, getContentTrackImageStatus, getAllWeeklyStories } from './db';
import { siteConfig } from './site-config';
import { categoryImagesFor } from '../config/category-images';
import { assertCategoryImagesComplete, assertImageExists, findContentTrackRowsMissingImage } from './images';
import { PAGE_META_PATTERNS } from '../config/page-meta';
import { resolvePageMeta } from './page-meta';
import { weekInfoForInstant, currentWeekInfo } from './this-week';

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
    const { title, h1 } = resolvePageMeta('facilities/detail', siteConfig, { FacilityName: facility.name });
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

/** Renamed from runBuildTimeImageChecks: this single build-time hook (still
 *  called once from BaseLayout.astro, still guarded by the same module-level
 *  `checked` flag) now also runs page_meta_check -- see
 *  assertPageMetaPatternsValid() above for why that belongs here rather
 *  than the Python validation/ package (NEEDS-HUMAN-REVIEW.md #48). */
export async function runBuildTimeChecks(): Promise<void> {
  if (checked) return;
  checked = true;
  assertCategoryImagesComplete(siteConfig, categoryImagesFor(siteConfig.townId));
  await assertVenueMatchingReachable();
  await assertContentTrackImagesComplete();
  await assertPageMetaPatternsValid();
}
