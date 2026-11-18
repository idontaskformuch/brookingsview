/** Which holiday pages exist for a town. A page is built for a town only when its data has at least one confirmed
 *  row from an official source (owner 2026-11-04: no empty shells, and no page where the town has no local effect):
 *  anything else is simply not built, so the host answers a real 404. */
import { hasConfirmedRow, type HolidayPageData } from '../../lib/holiday-page';
import { activeHoliday, inCalendarOrder, resolvePageState } from '../../lib/holiday-calendar';
import { HOLIDAY_PAGE_DEFS, defForCountry, holidayPageDef, type HolidayPageDef } from './calendar';
import { TOWN_REGISTRY } from '../../lib/town-registry.mjs';
import { buildVeteransDayPage } from './veterans-day';
import { buildThanksgivingPage, THANKSGIVING_CALENDAR_EXCLUDES } from './thanksgiving';
import { buildChristmasPage, CHRISTMAS_CALENDAR_EXCLUDES, CHRISTMAS_CALENDAR_INCLUDES } from './christmas';

export interface HolidayPageEntry { def: HolidayPageDef; page: HolidayPageData }

const BUILDERS: Record<HolidayPageDef['slug'], (townId: string) => HolidayPageData | null> = {
  'veterans-day': buildVeteransDayPage,
  thanksgiving: (t) => buildThanksgivingPage(t),
  christmas: buildChristmasPage,
};

/** Per holiday, the towns whose event calendars feed its Events group and the rows each excludes (by key). */
const CALENDAR_EXCLUDES: Partial<Record<HolidayPageDef['slug'], Record<string, Record<string, string>>>> = {
  thanksgiving: THANKSGIVING_CALENDAR_EXCLUDES,
  christmas: CHRISTMAS_CALENDAR_EXCLUDES,
};

/** The excluded keys of a town's calendar rows for a holiday, or null when the town's calendars take no part. */
export function calendarExcludesFor(slug: string, townId: string): Record<string, string> | null {
  const def = holidayPageDef(slug);
  if (!def?.calendarMatch) return null;
  return CALENDAR_EXCLUDES[def.slug]?.[townId] ?? null;
}

/** Per holiday, rows a town takes by key without a title match. */
const CALENDAR_INCLUDES: Partial<Record<HolidayPageDef['slug'], Record<string, Record<string, string>>>> = {
  christmas: CHRISTMAS_CALENDAR_INCLUDES,
};

/** The keys a town's calendar rows are taken by without a title match ({} when none). */
export function calendarIncludesFor(slug: string, townId: string): Record<string, string> {
  const def = holidayPageDef(slug);
  return (def && CALENDAR_INCLUDES[def.slug]?.[townId]) ?? {};
}

/** The page of one holiday for a town, or null when there is none (or no confirmed row). `def` is the town's country's
 *  version (calendar.ts defForCountry: the US Christmas window). */
export function holidayPageFor(slug: string, townId: string): HolidayPageEntry | null {
  const generic = holidayPageDef(slug);
  if (!generic) return null;
  const def = defForCountry(generic, TOWN_REGISTRY[townId]?.country ?? '');
  const page = BUILDERS[def.slug](townId);
  return page && hasConfirmedRow(page) ? { def, page } : null;
}

/** Every holiday page of a town (unordered). */
export function holidayPagesForTown(townId: string): HolidayPageEntry[] {
  return HOLIDAY_PAGE_DEFS.flatMap((d) => {
    const e = holidayPageFor(d.slug, townId);
    return e ? [e] : [];
  });
}

export function townHasHolidayPages(townId: string): boolean {
  return holidayPagesForTown(townId).length > 0;
}

/** The one holiday whose window is open (the nearest if two are), for the context card; null otherwise. A window
 *  that is open for a season the data does not cover counts as closed, so the card never promises stale facts. */
export function activeHolidayCard(townId: string, nowMs: number, timezone: string) {
  const covered = holidayPagesForTown(townId).filter((e) => resolvePageState(e.def, e.page.year, nowMs, timezone).kind === 'active');
  return activeHoliday(covered, nowMs, timezone);
}

export function holidayListing(townId: string, nowMs: number, timezone: string) {
  return inCalendarOrder(holidayPagesForTown(townId), nowMs, timezone);
}
