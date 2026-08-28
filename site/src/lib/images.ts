/**
 * Venue & Category Image Identity -- see NEEDS-HUMAN-REVIEW.md. One image
 * per PLACE and one image per CATEGORY, reused, instead of a per-article
 * generation cost. resolveImage() is the single entry point every
 * rendering surface should call; nothing else should reach for
 * `/og/<slug>.png` as an inline <img> src (that stays reserved for
 * og:image/twitter:image, see BaseLayout.astro -- unchanged by this file).
 *
 * RESOLUTION ORDER (resolveImage()):
 *   1. Article image   -- story.image_path, the real content-track illustration.
 *   2. Venue image      -- a resolved facility's own image_path.
 *   3. Category image   -- CATEGORY_IMAGES[town][category].
 *   4. Nothing.          Returns null. NEVER falls back to /og/<slug>.png --
 *      a missing image is honest; a reused social card pretending to be an
 *      article image is not.
 *
 * VENUE MATCHING -- deliberately DIFFERENT priority than a naive reading of
 * "trust the FK first" would suggest, and the reason is a real, verified
 * data problem, not a guess: Moreno Valley's library-program events (e.g.
 * "IRIS PLAZA: ABC's & 123's") carry a `venue_raw` that is WRONG for a
 * real, measured 18% of them (125 of 688 checked live against the actual
 * database) -- a recurring program hosted at multiple branches on
 * different days, where the scraped LOCATION field consistently attaches
 * the wrong branch's address to some instances (confirmed: 28 identical
 * rows, all "IRIS PLAZA: ABC's & 123's" titles, all carrying Main
 * Library's address). The event TITLE's own venue prefix ("IRIS PLAZA:")
 * is empirically the more trustworthy signal for these specifically, so
 * title-prefix matching is tried FIRST here, falling back to the
 * venue_raw/facility-alias resolution only when no recognizable title
 * prefix exists. This does NOT touch or second-guess the EXISTING
 * venue_raw-based Event JSON-LD resolution (lib/db.ts's resolveVenue(),
 * lib/event-jsonld.ts) -- that pipeline is unaffected and stays exactly
 * as it is; this is a separate, image-only resolution path.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Story, Facility, SourceType } from './db';
import type { SiteConfig } from './site-config';

export interface ImageRef {
  /** Root-relative local path ("/assets/images/...") for a downloaded and
   *  self-hosted image (Flux, Wikimedia Commons, Pexels -- everything this
   *  site has ever served before this feature), OR an absolute "https://"
   *  URL for a live-hotlinked image (Unsplash only -- its API terms
   *  prohibit downloading and re-hosting, see scripts/source_venue_images.py
   *  and NEEDS-HUMAN-REVIEW.md "Switch venue/category images to real
   *  photos"). assertImageExists() below only file-checks the former. */
  path: string;
  alt: string;
  width: number;
  height: number;
  /** Required credit line for a licensed real photo (Wikimedia Commons
   *  CC-BY/CC-BY-SA, Pexels, Unsplash) -- undefined for a Flux-generated
   *  image (no license/author to credit) or a public-domain Commons photo
   *  where crediting is good practice but not required (still populated
   *  when available -- see the migration's own note on never inferring a
   *  license). Rendered by every resolveImage() consumer as a small credit
   *  line under the image, not just tracked internally -- Pexels and
   *  Unsplash both make this a condition of API access, not a courtesy. */
  attributionText?: string;
  /** Link target for attributionText -- the photographer's profile
   *  (Unsplash/Pexels) or the Commons file page. Unsplash also requires
   *  UTM parameters on this URL (see the sourcing script) and firing a
   *  one-time "download" tracking ping when the photo is FIRST selected
   *  for use -- both handled at sourcing time, not on every render. */
  attributionUrl?: string;
  /** Pre-built trusted HTML for the rare case attributionText/Url's single
   *  link can't express -- specifically Unsplash, whose API Guidelines
   *  require the EXACT format "Photo by [Name] on Unsplash" with BOTH the
   *  name and "Unsplash" independently clickable (with UTM params on each).
   *  Built once by the sourcing script itself (never from unsanitized
   *  input -- this is trusted server-generated markup, same trust level as
   *  any other build-time-only value in this codebase), rendered via
   *  set:html. Takes priority over attributionText/Url when both are set. */
  attributionHtml?: string;
}

/** An ImageRef's path is either a local root-relative path or an absolute
 *  hotlink URL -- see ImageRef.path's own comment for why (Unsplash only).
 *  Every consumer that resolves a src attribute should treat both the same
 *  way (root-relative paths already resolve correctly as an <img src>, and
 *  an absolute https:// URL needs no resolution at all), but build-time
 *  file-existence checking only makes sense for the former. */
export function isHotlinkedImage(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/** The category vocabulary this feature covers -- see NEEDS-HUMAN-REVIEW.md
 *  for the full per-town list. Deliberately NOT every SourceType has one:
 *  content-track types (editorial, culture_essay, ...) always resolve via
 *  the article-image tier first, so they never need a category. */
export type ImageCategory =
  | 'city_hall' | 'events' | 'traffic' | 'home_sales' | 'jobs' | 'sports'
  | 'school_alerts' | 'weather_alert' | 'workplace_watch' | 'university';

/** Maps a story's source_type to its image category, for the automatic
 *  per-item resolution path (resolveImage()). Hub/section pages that want
 *  a fixed category hero regardless of any one item (e.g. /events/'s own
 *  header) should pass `category` directly instead of relying on this. */
const CATEGORY_BY_SOURCE_TYPE: Partial<Record<SourceType, ImageCategory>> = {
  meeting: 'city_hall',
  meeting_followup: 'city_hall',
  event: 'events',
  // 'weekly' has no dedicated category in the brief's own vocabulary (it's
  // a cross-cutting digest, not one section) -- 'events' is the closest
  // real fit (a week's worth of civic/community happenings), same
  // reasoning WeeklyRoundup.astro already applies elsewhere on this site.
  weekly: 'events',
  alert: 'weather_alert',
  home_sales_digest: 'home_sales',
  sports_digest: 'sports',
  local_sports_digest: 'sports',
  jackrabbits_season_summary: 'sports',
  university_digest: 'university',
  workplace_watch_digest: 'workplace_watch',
};

export function categoryForSourceType(sourceType: SourceType): ImageCategory | null {
  return CATEGORY_BY_SOURCE_TYPE[sourceType] ?? null;
}

/* --------------------------------------------- build-time completeness */
//
// See handoff "Broomfield has no hero image and no inline article images"
// (Phase 3): Broomfield's category-image pool was a silently-empty `{}`
// from the day the town was added until it was actually diagnosed --
// resolveImage() degrades to `null` on an empty pool with zero warning,
// which is correct AT THE PER-ARTICLE level (an individual miss is normal)
// but wrong at the WHOLE-TOWN level (an entire town with nothing to show,
// ever, for a category it actively needs). requiredCategoriesFor()/
// assertCategoryImagesComplete() are pure and DB-free on purpose, so they
// can run in a plain vitest test -- see images.test.ts -- as well as at
// real build time (called from BaseLayout.astro, see db.ts's
// runBuildTimeImageChecks()).

/** Every enabled town needs these regardless of feature flags: every town
 *  has meetings (city_hall), a weekly roundup (events), NOAA/NWS weather
 *  alerts (weather_alert), and Adzuna jobs (jobs). 'sports' is likewise
 *  universal today except Broomfield, which has no sports_digest/
 *  local_sports_digest-producing source at all (see NEEDS-HUMAN-REVIEW.md,
 *  "Broomfield launch") -- structurally unreachable, not just unpopulated,
 *  so it's correctly excluded rather than flagged as a gap. */
const ALWAYS_REQUIRED: ImageCategory[] = ['city_hall', 'events', 'weather_alert', 'jobs'];

/** The category pools an ENABLED town actually needs, derived from real,
 *  checkable feature flags -- not "every category for every town" (which
 *  would wrongly demand a 'university' pool for Broomfield, which has no
 *  SDSU-equivalent and can never produce a university_digest story). */
export function requiredCategoriesFor(config: Pick<SiteConfig,
  'townId' | 'hasWorkplaceWatch' | 'hasClosureWatch' | 'hasHousingMarket' | 'trafficSource'>,
): ImageCategory[] {
  const required = [...ALWAYS_REQUIRED];
  if (config.townId !== 'broomfield_co') required.push('sports');
  if (config.townId === 'brookings_sd') required.push('university');
  if (config.hasWorkplaceWatch) required.push('workplace_watch');
  if (config.hasClosureWatch) required.push('school_alerts');
  if (config.hasHousingMarket) required.push('home_sales');
  if (config.trafficSource) required.push('traffic');
  return required;
}

/** Content-track types (recipe/vardagsmiddag, editorial, culture essay,
 *  science column, review) resolve their image through story.image_path
 *  alone -- the article-image tier, see resolveImage()'s tier 1 -- and by
 *  design have NO category fallback (see CATEGORY_BY_SOURCE_TYPE above: none
 *  of them appear there). A null/empty image_path on one of these rows is
 *  therefore a real, PERMANENT gap for that specific item, not a normal
 *  resolveImage() miss that degrades gracefully -- see handoff "Build check
 *  for the article / content-track image tier". Pure so it's vitest-
 *  testable without a DB -- see images.test.ts. The DB query itself lives
 *  in db.ts's getContentTrackImageStatus(), called from build-checks.ts. */
export function findContentTrackRowsMissingImage<T extends { image_path: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.image_path);
}

/** Throws (fails the build) naming both the town and every missing/empty
 *  required category -- the actual bug this exists for was a whole town
 *  silently missing its ENTIRE pool with no build signal at all, so "fail
 *  loud, name everything" beats a vague warning. */
export function assertCategoryImagesComplete(
  config: Pick<SiteConfig, 'townId' | 'hasWorkplaceWatch' | 'hasClosureWatch' | 'hasHousingMarket' | 'trafficSource'>,
  categoryImages: Partial<Record<ImageCategory, ImageRef[]>>,
): void {
  const required = requiredCategoriesFor(config);
  const missing = required.filter((cat) => !categoryImages[cat] || categoryImages[cat]!.length === 0);
  if (missing.length > 0) {
    throw new Error(
      `Build-time image check failed for town "${config.townId}": missing or empty category ` +
      `image pool(s) for [${missing.join(', ')}]. Add real photo entries to ` +
      `site/src/config/category-images.ts for this town before building it -- ` +
      `see lib/images.ts's requiredCategoriesFor() for why each of these is required.`,
    );
  }
}

/* ------------------------------------------------------- venue matching */

const NOISE_WORDS = new Set(['library', 'branch', 'location', 'the']);

const EXPANSIONS: Record<string, string> = {
  mv: 'moreno valley',
  sdsu: 'south dakota state university',
};

/** Lowercase, expand known abbreviations, strip punctuation, collapse
 *  whitespace, drop trailing noise words -- applied to BOTH the candidate
 *  text and every stored alias before comparing, so "MV MALL Library" and
 *  a seeded "moreno valley mall" alias land on the same normalized form. */
export function normalizeVenueText(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => EXPANSIONS[w] ?? w)
    .flatMap((w) => w.split(' ')); // an expansion can itself be multi-word

  while (words.length > 1 && NOISE_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(' ');
}

/** The venue-prefix candidate from a story title, or null if the title
 *  has no colon-delimited prefix at all (most titles don't -- that's
 *  expected and not an error, it just means no title-prefix match is
 *  possible and venue_raw/facility resolution is tried instead).
 *
 *  Strips a leading "{cityName}: " town-name prefix FIRST (the SEO Fas 3
 *  retrofit + its forward-going pipeline fix, see NEEDS-HUMAN-REVIEW.md
 *  #27/#33, now puts one on most titles) -- without this step, splitting
 *  "Moreno Valley: IRIS PLAZA: Toddler Time" on the first colon would
 *  extract "Moreno Valley" itself as the venue candidate, which can never
 *  match a real facility. Confirmed live: 1,063 of 1,068 Moreno Valley
 *  event titles now carry this prefix. */
export function extractTitleVenuePrefix(title: string, cityName: string): string | null {
  const withoutTownPrefix = title.startsWith(`${cityName}: `) ? title.slice(cityName.length + 2) : title;
  const colonIndex = withoutTownPrefix.indexOf(':');
  if (colonIndex === -1) return null;
  const prefix = withoutTownPrefix.slice(0, colonIndex).trim();
  return prefix || null;
}

/** Builds a normalized-alias -> facility lookup, longest-alias-first so
 *  e.g. "mv mall library" is checked before the shorter "mv mall" (see
 *  facilities.name_aliases, db/migrations/026). Facilities with no
 *  name_aliases at all simply never match here -- expected for the many
 *  facilities (most parks) that only ever resolve via the category tier. */
export function buildNameAliasIndex(facilities: Pick<Facility, 'slug' | 'name_aliases'>[]): Map<string, string> {
  const entries: { normalized: string; slug: string }[] = [];
  for (const facility of facilities) {
    for (const alias of facility.name_aliases ?? []) {
      const normalized = normalizeVenueText(alias);
      if (normalized) entries.push({ normalized, slug: facility.slug });
    }
  }
  entries.sort((a, b) => b.normalized.length - a.normalized.length);
  const index = new Map<string, string>();
  for (const { normalized, slug } of entries) {
    if (!index.has(normalized)) index.set(normalized, slug);
  }
  return index;
}

/** Resolves a facility slug for image purposes from a story, trying (in
 *  order): title-prefix alias match, then venue_raw alias match against
 *  the SAME name_aliases table (comma-truncated, matching how venue_raw
 *  strings are shaped -- "Name,Street, City, ST ZIP"). Returns null if
 *  neither matches -- the caller falls through to the category tier. */
export function resolveVenueSlugForImage(
  story: Pick<Story, 'title' | 'venue_raw'>,
  nameAliasIndex: Map<string, string>,
  cityName: string,
): string | null {
  const titlePrefix = extractTitleVenuePrefix(story.title, cityName);
  if (titlePrefix) {
    const bySlugTitle = nameAliasIndex.get(normalizeVenueText(titlePrefix));
    if (bySlugTitle) return bySlugTitle;
  }
  if (story.venue_raw) {
    const namePart = story.venue_raw.split(',', 1)[0];
    const bySlugVenue = nameAliasIndex.get(normalizeVenueText(namePart));
    if (bySlugVenue) return bySlugVenue;
  }
  return null;
}

/** Build-time guard: `image_path` values are root-relative public paths
 *  (e.g. "/assets/images/venues/moreno_valley_ca-city-hall.png", see
 *  ai_pipeline/daily_content.py's own `"/" + saved.native.relative_to
 *  (PUBLIC_DIR)` convention -- reused here, not reinvented). A resolved
 *  reference that doesn't exist on disk throws immediately, naming both
 *  the offending path and the item it was resolved for -- per the brief,
 *  "never silently degrade" (see [slug].astro's existsSync/fileURLToPath
 *  crop-check for the established pattern this mirrors, though that one
 *  degrades gracefully by design -- a missing crop is optional, a missing
 *  primary image is not). */
export function assertImageExists(imagePath: string, itemSlug: string): void {
  // Hotlinked images (Unsplash only, see ImageRef.path's own comment) have
  // no local file to check -- their existence is the external CDN's
  // problem, not this build's.
  if (isHotlinkedImage(imagePath)) return;
  const absolute = fileURLToPath(new URL(`../../public${imagePath}`, import.meta.url));
  if (!existsSync(absolute)) {
    throw new Error(
      `resolveImage: "${itemSlug}" resolved to image_path "${imagePath}", but no file exists at ${absolute}. ` +
      'Fix the seeded image_path/CATEGORY_IMAGES entry, or add the missing asset -- never ship a broken <img src>.',
    );
  }
}

/** Root-relative paths of whichever crop variant(s) of `imagePath` actually
 *  exist on disk -- "-4x3.png" then "-1x1.png", only the ones that are real
 *  files -- see content/illustrations/generate_illustration.py's naming
 *  convention (only content-track/Flux-generated article images get these
 *  crops; venue and category images don't, and simply have no matching
 *  file, so this correctly returns [] for them rather than assuming which
 *  tier resolveImage() used).
 *
 *  Derives every crop path from `imagePath` ITSELF, never from a
 *  separately-passed story slug -- the bug this specifically avoids
 *  reproducing: [slug].astro's original additionalImages construction
 *  derived crop filenames from `story.slug` alone, which silently stopped
 *  matching real files the day image filenames became town-scoped
 *  ("{slug}-{town_id}.png", see the cross-town collision fix) for any
 *  content published since. ONE naming-convention implementation here,
 *  shared by withThumbnailCrop() (below) and [slug].astro's structured-
 *  data image[], instead of two independently-maintained copies of the
 *  same "-4x3.png"/"-1x1.png" string logic drifting apart again. */
export function contentTrackCropPaths(imagePath: string): string[] {
  if (isHotlinkedImage(imagePath) || !imagePath.endsWith('.png')) return [];
  const base = imagePath.slice(0, -'.png'.length);
  return ['-4x3.png', '-1x1.png']
    .map((suffix) => `${base}${suffix}`)
    .filter((candidate) => existsSync(fileURLToPath(new URL(`../../public${candidate}`, import.meta.url))));
}

/** Swaps in the smaller 4:3 crop of an already-resolved image, for list/
 *  card contexts (e.g. index.astro's "Latest from" strip) that want a
 *  thumbnail rather than the full hero-sized image. Deliberately non-
 *  throwing, unlike assertImageExists(): a missing crop is optional and
 *  falls back to the full image, never an error the way a missing PRIMARY
 *  image is -- same "optional asset" discipline contentTrackCropPaths()
 *  (and originally [slug].astro's own existsSync check) already
 *  established. */
export function withThumbnailCrop(image: ImageRef): ImageRef {
  const crop4x3 = contentTrackCropPaths(image.path).find((p) => p.endsWith('-4x3.png'));
  if (!crop4x3) return image;
  return { ...image, path: crop4x3, width: 1200, height: 900 };
}

/* -------------------------------------------------------- resolveImage */

export interface ResolveImageOptions {
  // Not read inside resolveImage() itself (categoryImages is already
  // resolved per-town by the caller via categoryImagesFor()) -- kept as a
  // plain string rather than a two-town union so a third town's real
  // townId doesn't need a false cast to compile.
  town: string;
  cityName: string;
  facilities: Pick<Facility, 'slug' | 'name_aliases' | 'image_path' | 'image_alt' | 'image_attribution_text' | 'image_attribution_url'>[];
  /** A POOL of 1-5 real photos per category (see NEEDS-HUMAN-REVIEW.md
   *  "Images still repeating across all pages, not just front page") --
   *  the real-photo migration left exactly one photo per category, which
   *  meant every card in a category showed the identical image sitewide,
   *  not just adjacently on one page (dedupeConsecutiveImages() only ever
   *  solved the adjacent case). resolveImage() now deterministically picks
   *  ONE image per pool per item -- see pickFromPool(). */
  categoryImages: Partial<Record<ImageCategory, ImageRef[]>>;
  /** Overrides the source_type-derived category -- for hub/section pages
   *  resolving their own fixed hero image rather than one item's image. */
  category?: ImageCategory | null;
}

export type ResolvableStory = Pick<Story, 'title' | 'source_type' | 'image_path' | 'image_alt' | 'venue_raw'>;

/** Deterministic pick from a pool, keyed on a stable per-item string (a
 *  story's slug, or its title when no slug exists -- see resolveImage()'s
 *  own itemSlug). Same seed always picks the same index, so the SAME story
 *  gets the SAME category image across rebuilds (no flicker on every
 *  hourly rebuild) while DIFFERENT stories in the same category spread
 *  across the pool instead of every single one collapsing onto image #1 --
 *  deliberately NOT random (Math.random() would reassign an already-
 *  published story's image on every rebuild for no reason). A plain
 *  string hash, not cryptographic -- collision resistance across a pool of
 *  1-5 items doesn't need anything stronger. */
export function pickFromPool<T>(pool: T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

/** The single entry point every rendering surface should call. Never
 *  fabricates a return value -- step 4 (null) is a normal, expected
 *  outcome, not a failure. */
export function resolveImage(story: ResolvableStory & { slug?: string }, options: ResolveImageOptions): ImageRef | null {
  const itemSlug = story.slug ?? story.title;

  // 1. Article image.
  if (story.image_path) {
    assertImageExists(story.image_path, itemSlug);
    return {
      path: story.image_path,
      alt: story.image_alt ?? `Illustration for "${story.title}"`,
      width: 1600, height: 900,
    };
  }

  // 2. Venue image.
  const nameAliasIndex = buildNameAliasIndex(options.facilities);
  const venueSlug = resolveVenueSlugForImage(story, nameAliasIndex, options.cityName);
  if (venueSlug) {
    const facility = options.facilities.find((f) => f.slug === venueSlug);
    if (facility?.image_path) {
      assertImageExists(facility.image_path, itemSlug);
      return {
        path: facility.image_path,
        alt: facility.image_alt ?? story.title,
        width: 1200, height: 800,
        attributionText: facility.image_attribution_text ?? undefined,
        attributionUrl: facility.image_attribution_url ?? undefined,
      };
    }
  }

  // 3. Category image -- deterministically picked from that category's
  // pool (see pickFromPool()), not always the pool's first/only entry.
  const category = options.category ?? categoryForSourceType(story.source_type);
  if (category) {
    const pool = options.categoryImages[category];
    if (pool && pool.length > 0) {
      const categoryImage = pickFromPool(pool, itemSlug);
      assertImageExists(categoryImage.path, itemSlug);
      return categoryImage;
    }
  }

  // 4. Nothing.
  return null;
}

/** Never render the same image twice in a row within one rendered
 *  section -- keeps it on the first item, drops it (sets `image: null`)
 *  from the immediately-following run of identical images. Only
 *  compares consecutively (not "anywhere earlier in the list"): the same
 *  venue appearing again after other images in between is fine, it's
 *  specifically a RUN of repeats that reads as broken. */
export function dedupeConsecutiveImages<T>(
  items: T[],
  getImage: (item: T) => ImageRef | null,
): { item: T; image: ImageRef | null }[] {
  const result: { item: T; image: ImageRef | null }[] = [];
  let previousPath: string | null = null;
  for (const item of items) {
    const image = getImage(item);
    const isRepeat = image !== null && image.path === previousPath;
    result.push({ item, image: isRepeat ? null : image });
    if (image) previousPath = image.path;
  }
  return result;
}
