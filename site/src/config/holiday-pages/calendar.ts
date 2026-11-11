/** The holidays that have a page (/veterans-day/, /thanksgiving/, /christmas/): when each page's window is open and
 *  what it says when it is not. Owner-ordered 2026-11-04 (.claude/specs/evergreen-holidays.md): the page is never
 *  noindex; the window only decides whether the page is "active" (this year's wording, a context card on the front
 *  page and /events/) or "evergreen" (the last season's facts, labelled with their year).
 *
 *  The window here is the PAGE window. The photo pool's window (config/holidays.ts HOLIDAYS.windowDays) is a
 *  separate field and is not touched; only the date rule is shared. */
import { HOLIDAYS, UK_HOLIDAYS, type HolidayDefinition, type HolidayId } from '../holidays';

export interface HolidayPageDef {
  /** URL path segment: /<slug>/ */
  slug: 'veterans-day' | 'thanksgiving' | 'christmas';
  label: string;
  /** Shares the date rule with the photo pool; nothing else. */
  holidayId: HolidayId;
  /** Page window: opens this many days before the day, closes this many days after it (inclusive). */
  daysBefore: number;
  daysAfter: number;
  /** Shown outside the window under the heading. `season` = year of the facts, `nextYear` = the coming occurrence. */
  evergreenNote: (season: number, nextYear: number) => string;
}

const HOURS_NOTE = (season: number, nextYear: number) =>
  `These are the ${season} hours. ${nextYear} hours will be added when they're announced.`;

export const HOLIDAY_PAGE_DEFS: HolidayPageDef[] = [
  // Closes on the day itself (owner 2026-11-11): from Nov 12 the page is the standing one, with no card on /events/.
  { slug: 'veterans-day', label: 'Veterans Day', holidayId: 'veterans_day', daysBefore: 10, daysAfter: 0, evergreenNote: HOURS_NOTE },
  { slug: 'thanksgiving', label: 'Thanksgiving', holidayId: 'thanksgiving', daysBefore: 10, daysAfter: 1, evergreenNote: HOURS_NOTE },
  // Glasgow's Christmas window opens six weeks before its first confirmed event (Nov 6) and closes Jan 3 (owner 2026-11-04).
  {
    slug: 'christmas', label: 'Christmas', holidayId: 'christmas', daysBefore: 91, daysAfter: 9,
    evergreenNote: (season, nextYear) => `These are the ${season} festive dates and times. ${nextYear} festive dates and times will be added when they're announced.`,
  },
];

export function holidayPageDef(slug: string): HolidayPageDef | undefined {
  return HOLIDAY_PAGE_DEFS.find((d) => d.slug === slug);
}

/** The date rule of a def, from the photo pool's definitions (US and UK lists). */
export function dateRuleOf(def: HolidayPageDef): HolidayDefinition['dateRule'] {
  const found = [...HOLIDAYS, ...UK_HOLIDAYS].find((h) => h.id === def.holidayId);
  if (!found) throw new Error(`no date rule for ${def.holidayId}`);
  return found.dateRule;
}
