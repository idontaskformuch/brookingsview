/** The pure rules behind the date tile, the relative-day label and the "already over today" dimming on event and calendar lists.
 *  Everything is a function of (instants or local day keys, now, timezone, country): no component decides anything itself, and the browser script
 *  (event-pop-client.ts) calls these same functions, so a static build and the page after it has been open for a while agree.
 *
 *  Day keys are the TOWN's local calendar days ("2026-11-12"); an instant is turned into one with the town's timezone, never the browser's. */
import { localDayNumber, hasEnded, type TimedEvent } from './local-day';
import { shortMonth, shortWeekday } from './calendar-strings';

type Country = 'us' | 'gb' | undefined;

export interface DayTileModel {
  /** small-caps line above the number: "WED · NOV", or just "NOV" for a range inside one month; null for a range over a month boundary */
  kicker: string | null;
  /** the big number: "12", or "25–29" for a range */
  day: string;
  /** a range over a month boundary: "DEC 31 – JAN 2" (gb: "31 DEC – 2 JAN") in the smaller style, instead of kicker + day */
  span: string | null;
  /** plain-text reading for assistive technology and the title attribute: "Wednesday 12 November" is not ours to guess, so "Wed Nov 12" / "Nov 25 to Nov 29" */
  label: string;
  kind: 'single' | 'range' | 'cross';
}

const ymd = (instant: Date, tz: string): { y: number; m: number; d: number } => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant).split('-').map(Number);
  return { y, m, d };
};
const weekdayOf = (p: { y: number; m: number; d: number }) => new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
const up = (s: string) => s.toUpperCase();
const date = (m: number, d: number, country: Country) => (country === 'gb' ? `${d} ${up(shortMonth(m, country))}` : `${up(shortMonth(m, country))} ${d}`);
const plain = (m: number, d: number, country: Country) => (country === 'gb' ? `${d} ${shortMonth(m, country)}` : `${shortMonth(m, country)} ${d}`);

/** `end` counts as a range only when it falls on a LATER local day than `start` (an event that ends at 22:00 the same evening is a single day). */
export function dayTile(start: Date | string, end: Date | string | null, tz: string, country: Country): DayTileModel {
  const s = ymd(new Date(start), tz);
  const e = end ? ymd(new Date(end), tz) : null;
  const sKey = s.y * 10000 + s.m * 100 + s.d;
  const eKey = e ? e.y * 10000 + e.m * 100 + e.d : sKey;
  if (!e || eKey <= sKey) {
    return { kind: 'single', kicker: `${up(shortWeekday(weekdayOf(s), country))} · ${up(shortMonth(s.m, country))}`, day: String(s.d), span: null,
             label: `${shortWeekday(weekdayOf(s), country)} ${plain(s.m, s.d, country)}` };
  }
  if (e.y === s.y && e.m === s.m) {
    return { kind: 'range', kicker: up(shortMonth(s.m, country)), day: `${s.d}–${e.d}`, span: null, label: `${plain(s.m, s.d, country)} to ${plain(e.m, e.d, country)}` };
  }
  return { kind: 'cross', kicker: null, day: '', span: `${date(s.m, s.d, country)} – ${date(e.m, e.d, country)}`,
           label: `${plain(s.m, s.d, country)} to ${plain(e.m, e.d, country)}` };
}

export const RELATIVE_MAX_DAYS = 6;

/** "Today" / "Tomorrow" / "In N days" (N up to 6) for a start that has not passed its local day; null for everything else
 *  (further out, an ongoing multi-day item, a day already gone). Calendar days in `tz`, not 24-hour blocks. */
export function relativeDayLabel(start: Date | string, now: Date, tz: string): string | null {
  return labelForDays(localDayNumber(new Date(start), tz) - localDayNumber(now, tz));
}

/** The same label for a plain calendar date ("2026-11-12", e.g. an academic-calendar row) compared with today's date in `tz`. */
export function relativeDayLabelForDate(day: string, now: Date, tz: string): string | null {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  return labelForDays(Math.round(Date.UTC(y, m - 1, d) / 86_400_000) - localDayNumber(now, tz));
}

function labelForDays(n: number): string | null {
  if (n < 0 || n > RELATIVE_MAX_DAYS) return null;
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
}

/** An item that is over: it has ended (its end, or the default length when none is given; an all-day item lasts to local midnight). Dropped from the
 *  list in the browser, as the older lists did. A multi-day item that has started but not ended is NOT over and stays. */
export function isOver(e: TimedEvent, now: Date, tz: string): boolean {
  return hasEnded(e, now, tz);
}
