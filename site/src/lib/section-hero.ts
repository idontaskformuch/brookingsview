/** Section hero images (/events, /today, /city-hall, /closures, Farm Report, ...)
 *  drawn from the SAME seasonal / holiday pools as the homepage's "This week"
 *  image -- no hard-coded pictures per section.
 *
 *  getSectionHero(town, section, date) is pure and DB-free so the rotation is
 *  unit-testable and two builds in the same ISO week always agree:
 *
 *   - Candidates = this town's pool for the week's meteorological season, plus
 *     the active holiday's pool when the week overlaps one (lib/holidays.ts).
 *   - The candidate list gets a FIXED per-(town, season) order, and week k's
 *     window is the next S entries of that cycle (S = how many sections the town
 *     has). Section j shows entry j of the window. So within a week every
 *     section gets a different image, and an image comes back only after
 *     floor(n / S) weeks.
 *   - The homepage's own image for the week (chosen with DB history in
 *     db.ts's resolveThisWeekImage) is passed in as `homepageImageId` and is
 *     never shown on a section that week.
 *   - The section's reserve image (its curated category photo) is used ONLY when
 *     the pool is empty for the date. No pool and no reserve throws.
 *
 *  HONEST LIMIT: "no repeat within two months" needs n >= 9 weeks x S distinct
 *  images per season and town. Pools hold ~15 today, so sectionHeroGapWeeks()
 *  reports the real gap and build-checks warns -- the rotation cannot create
 *  photos the pool does not have.
 */
import type { ImageRef } from './images';
import { stableHash, seasonForMonth, type Season } from './this-week-images';
import { weekInfoForInstant } from './this-week';
import { resolveActiveHoliday } from './holidays';
import { HOLIDAYS, holidayImagesFor } from '../config/holidays';
import { thisWeekImagesFor } from '../config/this-week-images';
import { categoryImagesFor } from '../config/category-images';
import type { ImageCategory } from './images';

export type HeroSection =
  | 'events' | 'today' | 'city_hall' | 'closures' | 'farm_report' | 'traffic'
  | 'home_sales' | 'jobs' | 'sports' | 'university' | 'workplace_watch';

/** Global slot order; a town's own active sections come first (see slotIndex). */
const ALL_SECTIONS: HeroSection[] = [
  'events', 'today', 'city_hall', 'closures', 'farm_report', 'traffic',
  'home_sales', 'jobs', 'sports', 'university', 'workplace_watch',
];

/** Which sections actually render a hero in each town -- this is S. */
const TOWN_SECTIONS: Record<string, HeroSection[]> = {
  brookings_sd: ['events', 'today', 'city_hall', 'closures', 'farm_report', 'home_sales', 'jobs', 'sports', 'university'],
  moreno_valley_ca: ['events', 'today', 'city_hall', 'closures', 'traffic', 'home_sales', 'jobs', 'sports', 'workplace_watch'],
  broomfield_co: ['events', 'today', 'city_hall', 'traffic', 'jobs', 'workplace_watch'],
};

const TOWN_TIMEZONE: Record<string, string> = {
  brookings_sd: 'America/Chicago',
  moreno_valley_ca: 'America/Los_Angeles',
  broomfield_co: 'America/Denver',
};

/** The curated category photo each section falls back to (reserve). */
const RESERVE_CATEGORY: Record<HeroSection, ImageCategory> = {
  events: 'events', today: 'events', city_hall: 'city_hall', closures: 'school_alerts',
  farm_report: 'jobs', traffic: 'traffic', home_sales: 'home_sales', jobs: 'jobs',
  sports: 'sports', university: 'university', workplace_watch: 'workplace_watch',
};

export interface SectionHeroOptions {
  timezone?: string;
  /** The homepage "This week" image id for the same week -- never repeated. */
  homepageImageId?: string | null;
  /** Test/override hooks; default to the real config pools. */
  seasonPool?: PoolImage[];
  holidayPool?: PoolImage[];
  reserve?: ImageRef[];
}

export interface PoolImage extends ImageRef { id: string }

export interface SectionHeroResult {
  image: ImageRef;
  /** 'rotation' = drawn from the seasonal/holiday pool; 'reserve' = pool empty. */
  source: 'rotation' | 'reserve';
  poolSize: number;
}

export function sectionsFor(town: string): HeroSection[] {
  return TOWN_SECTIONS[town] ?? ALL_SECTIONS;
}

/** This section's slot among its town's sections (unknown ones go after them). */
export function slotIndex(town: string, section: HeroSection): number {
  const active = sectionsFor(town);
  const i = active.indexOf(section);
  if (i >= 0) return i;
  const rest = ALL_SECTIONS.filter((s) => !active.includes(s));
  return active.length + Math.max(0, rest.indexOf(section));
}

function weekOrdinal(monday: { y: number; m: number; d: number }): number {
  return Math.round(Date.UTC(monday.y, monday.m - 1, monday.d) / (7 * 86_400_000));
}

/** Weeks before an image can recur in any section, given the pool size. */
export function sectionHeroGapWeeks(poolSize: number, sectionCount: number): number {
  return sectionCount <= 0 ? Infinity : Math.floor(poolSize / sectionCount);
}

function stableOrder<T extends { id: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`) || a.id.localeCompare(b.id));
}

export function getSectionHero(
  town: string, section: HeroSection, date: Date, opts: SectionHeroOptions = {},
): SectionHeroResult {
  const timezone = opts.timezone ?? TOWN_TIMEZONE[town] ?? 'America/Chicago';
  const week = weekInfoForInstant(date, timezone);
  const season: Season = seasonForMonth(week.monday.m);

  const seasonPool: PoolImage[] = opts.seasonPool
    ?? thisWeekImagesFor(town).filter((img) => img.seasons.includes(season));
  let holidayPool = opts.holidayPool;
  if (!holidayPool) {
    const match = resolveActiveHoliday(HOLIDAYS, week.monday, week.sunday);
    holidayPool = match ? holidayImagesFor(town, match.holiday) : [];
  }

  const seen = new Set<string>();
  const candidates = [...holidayPool, ...seasonPool].filter((img) => (seen.has(img.id) ? false : (seen.add(img.id), true)));

  if (candidates.length === 0) {
    const reservePool = opts.reserve ?? categoryImagesFor(town)[RESERVE_CATEGORY[section]] ?? [];
    if (reservePool.length === 0) {
      throw new Error(
        `getSectionHero: no hero for town "${town}", section "${section}", week ${week.slug}: the seasonal/holiday ` +
        `pool is empty for season "${season}" and the section has no reserve image (category "${RESERVE_CATEGORY[section]}"). ` +
        'Add images to config/this-week-images.ts, or a reserve to config/category-images.ts.',
      );
    }
    const pick = reservePool[stableHash(`${town}:${section}:${week.slug}`) % reservePool.length];
    return { image: pick, source: 'reserve', poolSize: 0 };
  }

  const order = stableOrder(candidates, `${town}:${season}`);
  const n = order.length;
  const S = sectionsFor(town).length;
  const k = weekOrdinal(week.monday);
  const base = ((k * S) % n + n) % n;
  const j = slotIndex(town, section);
  let pick = order[(base + j) % n];

  // Never the homepage's image: swap in the first entry beyond this week's
  // window that is neither the homepage image nor another section's image.
  if (opts.homepageImageId && pick.id === opts.homepageImageId) {
    const windowIds = new Set(Array.from({ length: Math.min(S, n) }, (_, i) => order[(base + i) % n].id));
    let found: PoolImage | undefined;
    for (let step = 0; step < n; step++) {
      const cand = order[(base + S + step) % n];
      if (cand.id !== opts.homepageImageId && !windowIds.has(cand.id)) { found = cand; break; }
    }
    pick = found ?? order[(base + j + 1) % n];
  }
  return { image: pick, source: 'rotation', poolSize: n };
}
