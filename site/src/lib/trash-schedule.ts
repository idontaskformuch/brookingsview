/** Brookings trash/recycling/yard-waste pickup dates, applying the City of Brookings' own holiday rule
 *  (https://www.cityofbrookings-sd.gov/260/Garbage-Collection, read 2026-10-23). Pure and dependency-free so
 *  the browser picker on /trash-recycling/ and the unit tests use the same code.
 *
 *  City rules, as written:
 *    - Sunday (except Easter) or Monday holiday: Monday's garbage and yard waste move to Tuesday, and
 *      Tuesday's move to Wednesday.
 *    - Tuesday holiday: garbage and yard waste move to Wednesday.
 *    - Thursday holiday: recycling and yard waste move to Wednesday.
 *    - Friday or Saturday holiday: Friday's recycling and yard waste move to Thursday, and Thursday's
 *      move to Wednesday.
 *    - Observed holidays: New Year's Day, Martin Luther King Jr. Day, Presidents' Day, Memorial Day,
 *      Juneteenth, Independence Day, Labor Day, Native American Day, Veterans Day, Thanksgiving Day,
 *      Christmas Day. (A Wednesday holiday has no rule: nothing is collected on Wednesdays.)
 *    - The rule is applied to the holiday's own calendar date (the city lists Sunday and Saturday
 *      holidays explicitly), in the Monday-to-Sunday week it affects (a Sunday holiday affects the
 *      Monday after it).
 *
 *  Dates are plain UTC-midnight "day numbers" built from y/m/d, never local times. */

export type Side = 'south' | 'north';
export type Stream = 'garbage' | 'recycling' | 'yard';

const DAY = 86_400_000;

/** Weekday numbers (0 = Sunday) of the normal pickup days. */
export const BASE_DAYS: Record<Side, Record<Stream, number[]>> = {
  south: { garbage: [1], recycling: [4], yard: [1, 4] },
  north: { garbage: [2], recycling: [5], yard: [2, 5] },
};

export const YARD_SEASON_2026 = { start: Date.UTC(2026, 3, 6), end: Date.UTC(2026, 10, 24) };

export interface Holiday { date: number; name: string }

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const weekday = (t: number) => new Date(t).getUTCDay();

/** The nth (1-based) given weekday of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): number {
  if (n > 0) {
    const first = utc(y, m, 1);
    return first + ((dow - weekday(first) + 7) % 7) * DAY + (n - 1) * 7 * DAY;
  }
  const last = utc(y, m + 1, 0);
  return last - ((weekday(last) - dow + 7) % 7) * DAY;
}

/** The city's collection holidays for one calendar year. */
export function holidaysFor(y: number): Holiday[] {
  return [
    { date: utc(y, 1, 1), name: "New Year's Day" },
    { date: nthWeekday(y, 1, 1, 3), name: 'Martin Luther King Jr. Day' },
    { date: nthWeekday(y, 2, 1, 3), name: "Presidents' Day" },
    { date: nthWeekday(y, 5, 1, -1), name: 'Memorial Day' },
    { date: utc(y, 6, 19), name: 'Juneteenth' },
    { date: utc(y, 7, 4), name: 'Independence Day' },
    { date: nthWeekday(y, 9, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(y, 10, 1, 2), name: 'Native American Day' }, // second Monday of October (South Dakota)
    { date: utc(y, 11, 11), name: 'Veterans Day' },
    { date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving Day' },
    { date: utc(y, 12, 25), name: 'Christmas Day' },
  ];
}

/** Monday (as a day number) of the Monday-to-Sunday pickup week a holiday affects. */
function affectedWeekStart(holiday: number): number {
  const w = weekday(holiday);
  if (w === 0) return holiday + DAY; // Sunday holiday -> the Monday after
  return holiday - (w - 1) * DAY;
}

/** weekday-in-the-affected-week -> weekday it moves to, by the holiday's own weekday. */
function shiftMap(holidayWeekday: number): Record<number, number> {
  switch (holidayWeekday) {
    case 0:
    case 1: return { 1: 2, 2: 3 };
    case 2: return { 2: 3 };
    case 4: return { 4: 3 };
    case 5:
    case 6: return { 5: 4, 4: 3 };
    default: return {}; // Wednesday: no collection that day, no rule
  }
}

/** The actual pickup date for one normal pickup weekday in the week starting `weekStart` (a Monday). */
export function actualPickup(weekStart: number, baseWeekday: number, holidays: Holiday[]): number {
  let dow = baseWeekday;
  for (const h of holidays) {
    if (affectedWeekStart(h.date) !== weekStart) continue;
    const moved = shiftMap(weekday(h.date))[baseWeekday];
    if (moved !== undefined) dow = moved;
  }
  return weekStart + (dow - 1) * DAY;
}

export interface NextPickup { date: number; shifted: boolean; holiday: string | null }

/** Next pickup on or after `today` for one stream, with the holiday rule applied.
 *  Yard waste returns null outside the 2026 season (April 6 to November 24). */
export function nextPickup(side: Side, stream: Stream, today: number): NextPickup | null {
  const y = new Date(today).getUTCFullYear();
  const holidays = [...holidaysFor(y - 1), ...holidaysFor(y), ...holidaysFor(y + 1)];
  const base = BASE_DAYS[side][stream];
  const weekStartToday = today - ((weekday(today) + 6) % 7) * DAY;
  let best: NextPickup | null = null;
  for (let w = 0; w < 10; w++) {
    const weekStart = weekStartToday + w * 7 * DAY;
    for (const dow of base) {
      const date = actualPickup(weekStart, dow, holidays);
      if (date < today) continue;
      if (stream === 'yard' && (date < YARD_SEASON_2026.start || date > YARD_SEASON_2026.end)) continue;
      if (best === null || date < best.date) {
        const normal = weekStart + (dow - 1) * DAY;
        const holiday = date !== normal
          ? holidays.find((h) => affectedWeekStart(h.date) === weekStart)?.name ?? null
          : null;
        best = { date, shifted: date !== normal, holiday };
      }
    }
    if (best) break;
  }
  return best;
}

/** Upcoming holidays in [from, from + days] with what moves where, for the page's holiday list. */
export function upcomingHolidayShifts(from: number, days: number, side: Side): { name: string; date: number; moves: string[] }[] {
  const y = new Date(from).getUTCFullYear();
  const out: { name: string; date: number; moves: string[] }[] = [];
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const h of [...holidaysFor(y), ...holidaysFor(y + 1)]) {
    if (h.date < from || h.date > from + days * DAY) continue;
    const weekStart = affectedWeekStart(h.date);
    const moves: string[] = [];
    for (const stream of ['garbage', 'recycling', 'yard'] as Stream[]) {
      for (const dow of BASE_DAYS[side][stream]) {
        const actual = actualPickup(weekStart, dow, [h]);
        const normal = weekStart + (dow - 1) * DAY;
        // Yard waste only runs in season (the 2026 season is the only one the city has published).
        if (stream === 'yard' && (normal < YARD_SEASON_2026.start || normal > YARD_SEASON_2026.end)) continue;
        if (actual !== normal) moves.push(`${stream === 'yard' ? 'Yard waste' : stream === 'garbage' ? 'Garbage' : 'Recycling'}: ${names[dow]} to ${names[weekday(actual)]}`);
      }
    }
    out.push({ name: h.name, date: h.date, moves });
  }
  return out;
}
