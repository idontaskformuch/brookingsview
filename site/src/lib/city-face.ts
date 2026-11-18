/** The town's face (spec .claude/specs/full-pages-no-ai-prose.md, Fas 1, owner decisions 2026-11-18): one real photo per week on the
 *  front page, a fixed photo per holiday window on the holiday page, and where the front-page photo goes. Pure and DB-free: db.ts's
 *  resolveThisWeekImage() is the thin shell that reads/records the history; this file decides.
 *
 *  - The week's front-page photo: an active holiday's pool first (the town's own holidays, lib/holidays.ts), else the season pool; never a
 *    photo shown on the front page in the last 60 days (selectThisWeekImage / selectHolidayImage).
 *  - The holiday page's band: one photo per holiday and window, reserved out of the holiday pool by a hash (no DB), so the front page
 *    rotates only among the rest. A pool smaller than the window's weeks + 1 reserves nothing and the page takes a season photo.
 *  - An alert lead gets no photo (no festive picture next to a warning); the photo then goes to the first secondary when that is a holiday
 *    or the weekend, otherwise it is not shown above the fold that day. */
import { thisWeekImagesFor, type ThisWeekImage } from '../config/this-week-images';
import { townHolidays, holidayImagesFor, type HolidayImage } from '../config/holidays';
import {
  holidayWindow, resolveActiveHoliday, selectHolidayImage, type DateYMD, type ActiveHolidayMatch,
} from './holidays';
import { selectThisWeekImage, seasonForMonth, stableHash, type Season, type ThisWeekUsageRecord } from './this-week-images';

export type CityImage = ThisWeekImage | HolidayImage;

const DAY_MS = 86_400_000;
const dayNum = (d: DateYMD) => Date.UTC(d.y, d.m - 1, d.d) / DAY_MS;
/** ISO weekday 1 (Mon) .. 7 (Sun) of a day number (1970-01-01 was a Thursday). */
const isoWeekday = (n: number) => ((((n + 3) % 7) + 7) % 7) + 1;

/** How many ISO weeks (Mon-Sun) overlap the holiday's window for `year`. */
export function weeksInWindow(def: { dateRule: Parameters<typeof holidayWindow>[0]['dateRule']; windowDays: number } & Parameters<typeof holidayWindow>[0], year: number): number {
  const w = holidayWindow(def, year);
  const start = dayNum(w.start); const end = dayNum(w.end);
  const firstMonday = start - (isoWeekday(start) - 1);
  const lastMonday = end - (isoWeekday(end) - 1);
  return (lastMonday - firstMonday) / 7 + 1;
}

/** The photo reserved for `holiday`'s page in the window that ends on that holiday's date in `year`: a stable hash over the pool sorted by
 *  id, so it is the same for every build in the window and needs no history. Null when the town has no active definition or pool for the
 *  holiday, or when the pool is smaller than the window's weeks + 1 (owner 2026-11-18: then the page takes a season photo and the front
 *  page keeps the whole pool). */
export function reservedHolidayImage(town: string, holiday: string, year: number): HolidayImage | null {
  const def = townHolidays(town).find((h) => h.id === holiday && h.active);
  if (!def) return null;
  return reserveFrom(holidayImagesFor(town, def.id), weeksInWindow(def, year), `${town}:${def.id}:${year}:page`);
}

/** The reservation rule on its own: nothing when the pool has fewer than `weeks` + 1 photos, else a stable hash over the pool by id. */
export function reserveFrom<T extends { id: string }>(pool: T[], weeks: number, seed: string): T | null {
  if (pool.length < weeks + 1) return null;
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[stableHash(seed) % sorted.length];
}

export interface WeekImageInput {
  town: string;
  isoYearWeek: string;
  monday: DateYMD;
  sunday: DateYMD;
  /** The town's season pool (all seasons; filtered here). */
  seasonPool: ThisWeekImage[];
  history: ThisWeekUsageRecord[];
  now: Date;
}

export interface WeekImagePick {
  /** null: nothing eligible (the caller fails the build, see db.ts). */
  image: CityImage | null;
  holiday: ActiveHolidayMatch | null;
  season: Season;
  /** An active holiday whose pool had nothing eligible: the pick fell back to the season pool. */
  holidayFellBack: boolean;
}

/** The front page's photo for one week, before it is recorded. The holiday pool excludes the photo reserved for the holiday's page. */
export function pickWeekImage(i: WeekImageInput): WeekImagePick {
  const season = seasonForMonth(i.monday.m);
  const match = resolveActiveHoliday(townHolidays(i.town), i.monday, i.sunday);
  let holidayFellBack = false;
  if (match) {
    const reserved = reservedHolidayImage(i.town, match.holiday, match.holidayDate.y);
    const pool = holidayImagesFor(i.town, match.holiday).filter((img) => img.id !== reserved?.id);
    const id = selectHolidayImage(pool, i.town, match.holiday, i.history, i.isoYearWeek, i.now);
    if (id) return { image: pool.find((img) => img.id === id)!, holiday: match, season, holidayFellBack };
    holidayFellBack = true;
  }
  const id = selectThisWeekImage(i.seasonPool, i.town, season, i.history, i.isoYearWeek, i.now);
  return { image: id ? i.seasonPool.find((img) => img.id === id)! : null, holiday: match, season, holidayFellBack };
}

/** A recorded id for a week, looked up in the season pool and the holiday's full pool (a row may name a photo recorded before the
 *  reservation existed). */
export function recordedWeekImage(town: string, id: string, monday: DateYMD, sunday: DateYMD, seasonPool: ThisWeekImage[]): CityImage | null {
  const match = resolveActiveHoliday(townHolidays(town), monday, sunday);
  return seasonPool.find((img) => img.id === id) ?? (match ? holidayImagesFor(town, match.holiday).find((img) => img.id === id) : undefined) ?? null;
}

/** The holiday page's band photo on local day `today`: the reserved photo while `today` is inside the holiday's own window, else (outside
 *  the window, a holiday with no pool, a pool too small to reserve from) a season photo chosen by a stable hash per page and week. Never the
 *  front page's photo of the week (`frontImageId`): a reserved photo that equals it (a week recorded before the reservation existed) gives
 *  way to the season photo. Null only when the town has no season photo at all. */
export function holidayBandImage(town: string, holiday: string, today: DateYMD, weekSlug: string, frontImageId: string | null): CityImage | null {
  const def = townHolidays(town).find((h) => h.id === holiday && h.active);
  if (def) {
    for (const y of [today.y - 1, today.y, today.y + 1]) {
      const w = holidayWindow(def, y);
      if (dayNum(today) >= dayNum(w.start) && dayNum(today) <= dayNum(w.end)) {
        const reserved = reservedHolidayImage(town, holiday, y);
        if (reserved && reserved.id !== frontImageId) return reserved;
        break;
      }
    }
  }
  const season = seasonForMonth(today.m);
  const pool = thisWeekImagesFor(town)
    .filter((img) => img.seasons.includes(season) && img.id !== frontImageId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return null;
  return pool[stableHash(`${town}:band:${holiday}:${weekSlug}`) % pool.length];
}

/** Ids reserved for holiday pages in the week [monday, sunday]: section heroes leave them out too, so the page's photo stays its own. */
export function reservedIdsForWeek(town: string, monday: DateYMD, sunday: DateYMD): Set<string> {
  const match = resolveActiveHoliday(townHolidays(town), monday, sunday);
  const r = match ? reservedHolidayImage(town, match.holiday, match.holidayDate.y) : null;
  return new Set(r ? [r.id] : []);
}

export type CityImageSlot = 'lead' | 'secondary' | null;

/** Where the week's photo goes on the front page: the lead, unless the lead is an alert; then the first secondary when it is a holiday or
 *  the weekend, else nowhere above the fold (owner 2026-11-18). */
export function cityImageSlot(page: { lead: { type: string }; secondaries: { type: string }[] }): CityImageSlot {
  if (page.lead.type !== 'alert') return 'lead';
  const first = page.secondaries[0]?.type;
  return first === 'holiday' || first === 'weekend' ? 'secondary' : null;
}

/** Responsive WebP widths built from the pools' 1200x800 JPGs (site/integrations/image-variants.mjs). 1200 is the source width: nothing is
 *  upscaled, so the spec's 1440 step is the 1200 file. */
export const VARIANT_WIDTHS = [640, 960, 1200] as const;
const VARIANT_SOURCE = /^\/assets\/images\/(this-week|holidays)\/[a-z0-9_-]+\.jpg$/;

export interface ResponsiveSrc { src: string; srcset?: string }
/** The WebP variants of a pool photo (src = the 960 file); any other path is returned as it is. */
export function responsiveSrc(path: string): ResponsiveSrc {
  if (!VARIANT_SOURCE.test(path)) return { src: path };
  const base = path.replace(/\.jpg$/, '');
  return { src: `${base}-960.webp`, srcset: VARIANT_WIDTHS.map((w) => `${base}-${w}.webp ${w}w`).join(', ') };
}

/** `sizes` per CityPhoto variant (the shell is 72rem wide on desktop, 1.25rem gutters on mobile). */
export const CITY_PHOTO_SIZES: Record<'lead' | 'band' | 'card' | 'thumb', string> = {
  lead: '(min-width: 75rem) 72rem, calc(100vw - 2.5rem)',
  band: '(min-width: 75rem) 72rem, calc(100vw - 2.5rem)',
  card: '(min-width: 40rem) 22rem, calc(100vw - 2.5rem)',
  thumb: '7.5rem',
};
