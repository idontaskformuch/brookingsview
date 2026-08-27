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
function assertImageExists(imagePath: string, itemSlug: string): void {
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

/* -------------------------------------------------------- resolveImage */

export interface ResolveImageOptions {
  // Not read inside resolveImage() itself (categoryImages is already
  // resolved per-town by the caller via categoryImagesFor()) -- kept as a
  // plain string rather than a two-town union so a third town's real
  // townId doesn't need a false cast to compile.
  town: string;
  cityName: string;
  facilities: Pick<Facility, 'slug' | 'name_aliases' | 'image_path' | 'image_alt' | 'image_attribution_text' | 'image_attribution_url'>[];
  categoryImages: Partial<Record<ImageCategory, ImageRef>>;
  /** Overrides the source_type-derived category -- for hub/section pages
   *  resolving their own fixed hero image rather than one item's image. */
  category?: ImageCategory | null;
}

export type ResolvableStory = Pick<Story, 'title' | 'source_type' | 'image_path' | 'image_alt' | 'venue_raw'>;

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

  // 3. Category image.
  const category = options.category ?? categoryForSourceType(story.source_type);
  if (category) {
    const categoryImage = options.categoryImages[category];
    if (categoryImage) {
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
