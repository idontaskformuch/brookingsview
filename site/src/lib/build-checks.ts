/** Build-time safety net -- see handoff "Broomfield has no hero image and
 *  no inline article images" (Phase 3). Two independent checks, both fail
 *  the build loudly by design (a whole town silently missing image/venue-
 *  matching coverage is exactly the failure mode neither one ever surfaced
 *  on its own until this was diagnosed by hand):
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
 *
 *  Called once from BaseLayout.astro (every real page renders it), guarded
 *  by a module-level flag so a build with hundreds of pages only actually
 *  runs the DB query once, not once per page. Never called at module
 *  import time and never imported by a vitest test -- `astro check` never
 *  executes this file at all (pure type-checking, no runtime), and vitest
 *  has no reason to import it, so neither needs DATABASE_URL just to run.
 */
import { TOWN_ID, getFacilities, hasAnyStoryWithVenueRaw } from './db';
import { siteConfig } from './site-config';
import { categoryImagesFor } from '../config/category-images';
import { assertCategoryImagesComplete } from './images';

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

export async function runBuildTimeImageChecks(): Promise<void> {
  if (checked) return;
  checked = true;
  assertCategoryImagesComplete(siteConfig, categoryImagesFor(siteConfig.townId));
  await assertVenueMatchingReachable();
}
