/** Which holiday pages exist for a town. A page is built for a town only when its data has at least one confirmed
 *  row from an official source (owner 2026-11-04: no empty shells, and no page where the town has no local effect):
 *  anything else is simply not built, so the host answers a real 404. */
import { hasConfirmedRow, type HolidayPageData } from '../../lib/holiday-page';
import { activeHoliday, inCalendarOrder, resolvePageState } from '../../lib/holiday-calendar';
import { HOLIDAY_PAGE_DEFS, holidayPageDef, type HolidayPageDef } from './calendar';
import { buildVeteransDayPage } from './veterans-day';
import { buildThanksgivingPage } from './thanksgiving';
import { buildChristmasPage } from './christmas';

export interface HolidayPageEntry { def: HolidayPageDef; page: HolidayPageData }

const BUILDERS: Record<HolidayPageDef['slug'], (townId: string) => HolidayPageData | null> = {
  'veterans-day': buildVeteransDayPage,
  thanksgiving: (t) => buildThanksgivingPage(t),
  christmas: buildChristmasPage,
};

/** The page of one holiday for a town, or null when there is none (or no confirmed row). */
export function holidayPageFor(slug: string, townId: string): HolidayPageEntry | null {
  const def = holidayPageDef(slug);
  if (!def) return null;
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
