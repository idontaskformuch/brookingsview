/** Dates and states of the holiday pages. Pure; days are UTC-midnight numbers like the old per-holiday helpers.
 *  The data (which holidays, window sizes, evergreen wording) is in config/holiday-pages/calendar.ts.
 *  "Now" is read as the town's own calendar day (localDay), so a window opens and closes at the town's midnight,
 *  not UTC's (2026-11-12: Veterans Day's window closed at 5pm MST on the day itself). */
import { computeHolidayDate } from './holidays';
import { dateRuleOf, type HolidayPageDef } from '../config/holiday-pages/calendar';

const DAY = 86_400_000;

/** The holiday itself in a given year, UTC midnight. */
export function occurrenceDay(def: HolidayPageDef, year: number): number {
  const { y, m, d } = computeHolidayDate(dateRuleOf(def), year);
  return Date.UTC(y, m - 1, d);
}

/** First day of the page window, and the first day after it. */
export function pageWindow(def: HolidayPageDef, year: number): { start: number; endExclusive: number } {
  const day = occurrenceDay(def, year);
  return { start: day - def.daysBefore * DAY, endExclusive: day + (def.daysAfter + 1) * DAY };
}

export type HolidayPageState =
  | { kind: 'active'; year: number; day: number }
  | { kind: 'evergreen'; nextYear: number; nextDay: number };

/** The town's calendar day at `nowMs`, as a UTC-midnight day number (same scale as occurrenceDay). */
export function localDay(nowMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/** The first occurrence on or after the town's today. */
export function nextOccurrence(def: HolidayPageDef, nowMs: number, timezone: string): { year: number; day: number } {
  const today = localDay(nowMs, timezone);
  const y = new Date(today).getUTCFullYear();
  for (const year of [y, y + 1]) {
    const day = occurrenceDay(def, year);
    if (day >= today) return { year, day };
  }
  return { year: y + 2, day: occurrenceDay(def, y + 2) };
}

/** Active while a window (this year's, or the previous/next year's when it crosses New Year) holds the town's today. */
export function pageState(def: HolidayPageDef, nowMs: number, timezone: string): HolidayPageState {
  const today = localDay(nowMs, timezone);
  const y = new Date(today).getUTCFullYear();
  for (const year of [y - 1, y, y + 1]) {
    const w = pageWindow(def, year);
    if (today >= w.start && today < w.endExclusive) return { kind: 'active', year, day: occurrenceDay(def, year) };
  }
  const next = nextOccurrence(def, nowMs, timezone);
  return { kind: 'evergreen', nextYear: next.year, nextDay: next.day };
}

/** The def whose window is open and whose day is nearest (an upcoming day wins a tie). Null when no window is open. */
export function activeHoliday<T extends { def: HolidayPageDef }>(entries: T[], nowMs: number, timezone: string): (T & { day: number }) | null {
  const today = localDay(nowMs, timezone);
  let best: (T & { day: number }) | null = null;
  let bestDist = Infinity;
  for (const e of entries) {
    const s = pageState(e.def, nowMs, timezone);
    if (s.kind !== 'active') continue;
    const dist = Math.abs(s.day - today) * 2 + (s.day < today ? 1 : 0);
    if (dist < bestDist) { best = { ...e, day: s.day }; bestDist = dist; }
  }
  return best;
}

/** Calendar order, the next holiday first (the one whose day is soonest on or after today). */
export function inCalendarOrder<T extends { def: HolidayPageDef }>(entries: T[], nowMs: number, timezone: string): (T & { day: number })[] {
  return entries
    .map((e) => ({ ...e, day: nextOccurrence(e.def, nowMs, timezone).day }))
    .sort((a, b) => a.day - b.day);
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wednesday" for a UTC-midnight day number. */
export function weekdayLong(day: number): string {
  return WEEKDAYS_LONG[new Date(day).getUTCDay()];
}

/** "Wednesday, Nov 11, 2027" (en-GB: "Wednesday 11 Nov 2027"). */
export function formatDayLong(day: number, locale: 'en-US' | 'en-GB' = 'en-US'): string {
  const d = new Date(day);
  const wd = WEEKDAYS_LONG[d.getUTCDay()];
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  return locale === 'en-GB'
    ? `${wd} ${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`
    : `${wd}, ${mon} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Nov 11" (en-GB: "11 Nov"), for the context card. */
export function formatDayShort(day: number, locale: 'en-US' | 'en-GB' = 'en-US'): string {
  const d = new Date(day);
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  return locale === 'en-GB' ? `${d.getUTCDate()} ${mon}` : `${mon} ${d.getUTCDate()}`;
}

/** The state a page is rendered in. A window that is open for a year the data does not cover (the config has not
 *  been refreshed yet) counts as evergreen, so the page never claims the old season's facts are the new year's. */
export function resolvePageState(def: HolidayPageDef, dataSeason: number, nowMs: number, timezone: string): HolidayPageState {
  const s = pageState(def, nowMs, timezone);
  if (s.kind === 'active' && s.year !== dataSeason) return { kind: 'evergreen', nextYear: s.year, nextDay: s.day };
  return s;
}

/** The two lines an evergreen page shows under its heading: which season the facts are for (only when a later
 *  occurrence is coming, otherwise the facts already are the upcoming ones) and when the next one is. */
export function evergreenLines(
  def: HolidayPageDef, dataSeason: number, state: Extract<HolidayPageState, { kind: 'evergreen' }>, locale: 'en-US' | 'en-GB' = 'en-US',
): { note: string | null; next: string } {
  return {
    note: state.nextYear > dataSeason ? def.evergreenNote(dataSeason, state.nextYear) : null,
    next: `Next ${def.label}: ${formatDayLong(state.nextDay, locale)}`,
  };
}
