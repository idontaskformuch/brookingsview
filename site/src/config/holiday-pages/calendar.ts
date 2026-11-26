/** The holidays that have a page (/veterans-day/, /thanksgiving/, /christmas/): when each page's window is open and
 *  what it says when it is not. Owner-ordered 2026-11-04 (.claude/specs/evergreen-holidays.md): the page is never
 *  noindex; the window only decides whether the page is "active" (this year's wording, a context card on the front
 *  page and /events/) or "evergreen" (the last season's facts, labelled with their year).
 *
 *  The window here is the PAGE window. The photo pool's window (config/holidays.ts HOLIDAYS.windowDays) is a
 *  separate field and is not touched; only the date rule is shared. */
import { HOLIDAYS, UK_HOLIDAYS, type HolidayDefinition, type HolidayId } from '../holidays';
import { lastSeasonBankHoliday } from '../../lib/holiday-season';
import { SCOTLAND_BANK_HOLIDAYS } from './gb/bank-holidays';

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
  /** Rows from the town's own event calendars (the /events/ pipeline) whose title matches `pattern` and whose local day is
   *  from `daysBefore` before the holiday to `daysAfter` after it are listed under Events (owner 2026-11-14, B2). Plain
   *  regex on the title, no model. A town takes part only with an entry in registry.ts CALENDAR_EXCLUDES. */
  calendarMatch?: { pattern: RegExp; daysBefore: number; daysAfter: number };
  /** The last day (YYYY-MM-DD) the window must still cover for the season starting in `year`, when that is later than
   *  `daysAfter` (a substitute bank holiday, owner 2026-11-14); null = `daysAfter` only. */
  extendTo?: (year: number) => string | null;
  /** The page window in US towns when it differs (owner 2026-11-18, B1: US Christmas Nov 28 – Jan 3, Glasgow keeps its own).
   *  `extendTo` (GOV.UK Scotland) does not apply there. See defForCountry. */
  usWindow?: { daysBefore: number; daysAfter: number };
  /** 'festive' = components/holiday/HolidayFestivePage.astro in every town (owner 2026-11-26, design lift pilot): advent strip,
   *  holiday matrix, day blocks. Absent = the standard holiday template. */
  layout?: 'festive';
}

const HOURS_NOTE = (season: number, nextYear: number) =>
  `These are the ${season} hours. ${nextYear} hours will be added when they're announced.`;

export const HOLIDAY_PAGE_DEFS: HolidayPageDef[] = [
  // Closes on the day itself (owner 2026-11-11): from Nov 12 the page is the standing one, with no card on /events/.
  { slug: 'veterans-day', label: 'Veterans Day', holidayId: 'veterans_day', daysBefore: 10, daysAfter: 0, evergreenNote: HOURS_NOTE },
  // Calendar rows: the week before through the Sunday after, so a tree lighting the same weekend is included (owner 2026-11-14);
  // "friendsgiving" added 2026-11-15 (owner).
  {
    slug: 'thanksgiving', label: 'Thanksgiving', holidayId: 'thanksgiving', daysBefore: 10, daysAfter: 1, evergreenNote: HOURS_NOTE,
    calendarMatch: { pattern: /thanksgiving|friendsgiving|turkey (?:trot|day)|gobble|tree lighting/i, daysBefore: 7, daysAfter: 3 },
  },
  // Glasgow's Christmas window opens six weeks before its first confirmed event (Nov 6) and closes Jan 3 (owner 2026-11-04), or
  // later when GOV.UK's Scotland list has a later bank holiday in the season: 2026/27 ends Mon 4 Jan, gone 5 Jan (owner 2026-11-14).
  // Calendar rows: from a month before (the festive concerts start early December) to the last day of the window.
  {
    slug: 'christmas', label: 'Christmas', holidayId: 'christmas', daysBefore: 91, daysAfter: 9,
    evergreenNote: (season, nextYear) => `These are the ${season} festive dates and times. ${nextYear} festive dates and times will be added when they're announced.`,
    calendarMatch: { pattern: /christmas|xmas|festive|santa|panto|carol|hogmanay|new year/i, daysBefore: 30, daysAfter: 9 },
    extendTo: (year) => lastSeasonBankHoliday(SCOTLAND_BANK_HOLIDAYS, year),
    // US: from the day after the Thanksgiving window (Nov 28 = 27 days before) to Jan 3 (owner 2026-11-18, B1).
    usWindow: { daysBefore: 27, daysAfter: 9 },
    layout: 'festive',
  },
];

export function holidayPageDef(slug: string): HolidayPageDef | undefined {
  return HOLIDAY_PAGE_DEFS.find((d) => d.slug === slug);
}

/** The def as it applies in a country: in the US a `usWindow` replaces the window, and `extendTo` (Scotland's bank holidays)
 *  is dropped. Unchanged elsewhere. */
export function defForCountry(def: HolidayPageDef, country: string): HolidayPageDef {
  if (country !== 'us' || !def.usWindow) return def;
  const { extendTo: _dropped, ...rest } = def;
  void _dropped;
  return { ...rest, daysBefore: def.usWindow.daysBefore, daysAfter: def.usWindow.daysAfter };
}

/** The date rule of a def, from the photo pool's definitions (US and UK lists). */
export function dateRuleOf(def: HolidayPageDef): HolidayDefinition['dateRule'] {
  const found = [...HOLIDAYS, ...UK_HOLIDAYS].find((h) => h.id === def.holidayId);
  if (!found) throw new Error(`no date rule for ${def.holidayId}`);
  return found.dateRule;
}
