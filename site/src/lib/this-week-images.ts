/**
 * Pure selection logic for the "This week" segment's weekly-rotating image
 * -- see config/this-week-images.ts for the photo pool itself and db.ts's
 * resolveThisWeekImage() for the history-reading/writing orchestration
 * around this. Kept DB-free and pure specifically so the real rotation
 * behavior (60-day no-repeat, seasonal filtering, deterministic tie-break,
 * no cross-town leak) is testable without a database -- see
 * this-week-images.test.ts.
 */
import type { ThisWeekImage } from '../config/this-week-images';
import type { Town } from '../config/category-images';

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Meteorological seasons, Northern Hemisphere (the brief's own definition,
 *  not the astronomical equinox/solstice dates) -- `month` is a plain
 *  1-12 calendar month number, already resolved to the TOWN's own local
 *  timezone by the caller (see db.ts's resolveThisWeekImage(), which reads
 *  it off lib/this-week.ts's WeekInfo.monday.m -- the same DateParts every
 *  other week-boundary calculation in this codebase already uses, not a
 *  second timezone conversion). */
export function seasonForMonth(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

const SEASON_ORDER: Season[] = ['winter', 'spring', 'summer', 'autumn'];

export function nextSeason(season: Season): Season {
  return SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % SEASON_ORDER.length];
}

/** Meteorological season boundaries -- the brief's own four dates (Dec 1,
 *  Mar 1, Jun 1, Sep 1), matching seasonForMonth()'s own month cutoffs. */
const SEASON_START: Record<Season, { month: number; day: number }> = {
  winter: { month: 12, day: 1 },
  spring: { month: 3, day: 1 },
  summer: { month: 6, day: 1 },
  autumn: { month: 9, day: 1 },
};

/** Day-of-year ordinal under a FIXED, deliberately non-leap reference year
 *  (2001) -- only relative distances between two month/day pairs matter
 *  here, never a real calendar year, so a fixed reference avoids a leap
 *  year shifting every later ordinal by one day. A real Feb 29 input
 *  overflows to March 1 in this non-leap reference year, which happens to
 *  land on the SAME ordinal a real Feb 29 would have anyway (one day after
 *  Feb 28 either way) -- not a bug, just worth noting why it's not one. */
function ordinalDayOfYear(month: number, day: number): number {
  return Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 86_400_000);
}

const DAYS_IN_REFERENCE_YEAR = 365;

/** Days from today (`month`/`day`, the town's own local calendar) forward
 *  to `season`'s next start date -- always wraps FORWARD, never backward:
 *  e.g. today Jan 15 asking about winter (already started Dec 1) returns
 *  ~320, the days until the FOLLOWING Dec 1, not a negative "46 days ago".
 *  Callers only ever ask this about the season AFTER the current one (see
 *  seasonPoolSizes() below), so the "already in that season" case doesn't
 *  arise in practice, but the wraparound is still correct either way. */
export function daysUntilSeasonStart(month: number, day: number, season: Season): number {
  const today = ordinalDayOfYear(month, day);
  const target = ordinalDayOfYear(SEASON_START[season].month, SEASON_START[season].day);
  return (target - today + DAYS_IN_REFERENCE_YEAR) % DAYS_IN_REFERENCE_YEAR;
}

/** Minimum pool size (per town+season) for the 60-day no-repeat rule to be
 *  sustainable FOREVER under a weekly rotation, not just lucky for a while:
 *  with N images shown once a week each, the same image repeats every N
 *  weeks. N=9 -> 63 days (>= 60, holds). N=8 -> 56 days (< 60, WILL
 *  eventually violate the rule no matter how usage history plays out) --
 *  this is a structural fact about the rotation, not a heuristic. */
export const MIN_POOL_SIZE_FOR_60_DAY_RULE = 9;

/** The brief's own stated minimum (see config/this-week-images.ts's module
 *  comment) -- a pool at or above MIN_POOL_SIZE_FOR_60_DAY_RULE but below
 *  this is mechanically safe but thinner than intended (less real variety
 *  week to week), worth a build warning, not a failure. */
export const RECOMMENDED_MIN_POOL_SIZE = 13;

export interface SeasonPoolSize {
  season: Season;
  /** 'current': this town+season right now. 'next': only included when the
   *  caller's `daysBeforeShift` window puts the upcoming season's own start
   *  date within range -- see seasonPoolSizes(). */
  scope: 'current' | 'next';
  poolSize: number;
}

/**
 * Per-town pool-size audit, independent of any specific week: always
 * reports the CURRENT season's pool size, and additionally reports the
 * NEXT season's pool size when today falls within `daysBeforeShift` days of
 * that next season's own start date -- giving curators (scripts/
 * source_this_week_images.py) advance notice before the rotation actually
 * needs it, rather than discovering a gap only once the season has already
 * turned over (which weeksCoverage()'s rolling 8-week window would
 * eventually catch too, but only once the boundary is eight weeks out at
 * most -- this can warn earlier, independent of that horizon, and keeps
 * firing every build until the gap is actually closed, not just once).
 */
export function seasonPoolSizes(
  pool: ThisWeekImage[],
  townId: string,
  month: number,
  day: number,
  daysBeforeShift: number,
): SeasonPoolSize[] {
  const sizeFor = (season: Season) => pool.filter(
    (img) => img.town_ids.includes(townId as Town) && img.seasons.includes(season),
  ).length;

  const current = seasonForMonth(month);
  const results: SeasonPoolSize[] = [{ season: current, scope: 'current', poolSize: sizeFor(current) }];

  const upcoming = nextSeason(current);
  if (daysUntilSeasonStart(month, day, upcoming) <= daysBeforeShift) {
    results.push({ season: upcoming, scope: 'next', poolSize: sizeFor(upcoming) });
  }
  return results;
}

export interface ThisWeekUsageRecord {
  imageId: string;
  shownAt: Date;
}

export interface WeekCoverage {
  isoYearWeek: string;
  season: Season;
  poolSize: number;
}

/**
 * Forward-looking, pool-only coverage audit for the "This week" image pool
 * -- deliberately ignores the 60-day no-repeat usage history (that's
 * selectThisWeekImage()'s job, applied to the single CURRENT week by
 * db.ts's resolveThisWeekImage()). This answers a simpler, static question
 * an editor can act on well before a week actually runs dry: "does
 * config/this-week-images.ts have ANY entry at all for this town+season,
 * for each of the next N weeks" -- see build-checks.ts's
 * assertThisWeekImageCoverage() for the warn/fail thresholds built on top
 * of this.
 *
 * `weeks` is supplied by the caller (real ISO-week slug + 1-12 calendar
 * month, in the town's own timezone, via lib/this-week.ts's
 * weekInfoForInstant()) rather than computed here, so this file stays
 * DB-free and has no dependency on this-week.ts's own heavier imports --
 * same "accept already-resolved inputs" shape selectThisWeekImage() already
 * uses for isoYearWeek/season.
 */
export function weeksCoverage(
  pool: ThisWeekImage[],
  townId: string,
  weeks: { isoYearWeek: string; month: number }[],
): WeekCoverage[] {
  return weeks.map(({ isoYearWeek, month }) => {
    const season = seasonForMonth(month);
    const poolSize = pool.filter(
      (img) => img.town_ids.includes(townId as Town) && img.seasons.includes(season),
    ).length;
    return { isoYearWeek, season, poolSize };
  });
}

/**
 * How many weeks of coverage exist starting from `coverage[0]` (the current
 * week), counting consecutively until the first empty week -- e.g.
 * poolSizes [3, 3, 0, 5] -> 2, not 3: a later non-empty week doesn't un-gap
 * an earlier one, since the real rotation reaches weeks in order and would
 * already have failed at the empty one.
 */
export function forwardCoverageWeeks(coverage: WeekCoverage[]): number {
  let n = 0;
  for (const week of coverage) {
    if (week.poolSize === 0) break;
    n++;
  }
  return n;
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/** Same plain string hash lib/images.ts's pickFromPool() already uses for
 *  its own deterministic pick -- reused rather than a second hash scheme,
 *  not collision-resistant and doesn't need to be (tie-break among a
 *  handful of equally-eligible candidates). */
function stableHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Picks this week's image for one town, or `null` when no eligible
 * candidate exists -- the caller (db.ts's resolveThisWeekImage()) treats
 * `null` as a hard build failure, never a silent fallback to a recently-
 * shown or wrong-season image.
 *
 * Algorithm (per the brief):
 *   1. Filter the pool to this town + the current season.
 *   2. Exclude anything shown to this SAME town in the last 60 real days --
 *      a hard rule, not a preference: if every eligible image was shown
 *      recently, this returns null rather than reusing one.
 *   3. Among what's left, prefer whichever was shown longest ago (never
 *      shown = older than any real timestamp, so new additions to the pool
 *      are always preferred over a long-ago repeat).
 *   4. Tie-break deterministically on hash(townId + isoYearWeek) -- so a
 *      same-week rebuild with the SAME history always picks the SAME image
 *      even before the DB-level "reuse the saved row" check runs (that
 *      check is still what actually guarantees stability once a row has
 *      been written -- this just means two independent selections over
 *      identical inputs can never disagree).
 *
 * `history` is every usage row for THIS town (any age) -- the 60-day filter
 * is applied here, not by the caller, so this function is self-contained
 * and safe to call with an unfiltered or over-fetched history list.
 */
export function selectThisWeekImage(
  pool: ThisWeekImage[],
  townId: string,
  season: Season,
  history: ThisWeekUsageRecord[],
  isoYearWeek: string,
  now: Date,
): string | null {
  const eligible = pool.filter(
    (img) => img.town_ids.includes(townId as Town) && img.seasons.includes(season),
  );
  if (eligible.length === 0) return null;

  const cutoff = now.getTime() - SIXTY_DAYS_MS;
  const recentlyShown = new Set(
    history.filter((h) => h.shownAt.getTime() >= cutoff).map((h) => h.imageId),
  );
  const candidates = eligible.filter((img) => !recentlyShown.has(img.id));
  if (candidates.length === 0) return null;

  const lastShownAt = new Map<string, number>();
  for (const h of history) {
    const prev = lastShownAt.get(h.imageId);
    if (prev === undefined || h.shownAt.getTime() > prev) lastShownAt.set(h.imageId, h.shownAt.getTime());
  }

  let oldest = Infinity;
  for (const c of candidates) {
    const t = lastShownAt.get(c.id) ?? -Infinity;
    if (t < oldest) oldest = t;
  }
  const tied = candidates.filter((c) => (lastShownAt.get(c.id) ?? -Infinity) === oldest);
  const pick = tied[stableHash(`${townId}:${isoYearWeek}`) % tied.length];
  return pick.id;
}
