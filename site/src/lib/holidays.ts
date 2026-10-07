/**
 * Pure date-rule, window-overlap, and selection logic for the holiday
 * image overlay -- see config/holidays.ts for the holiday definitions and
 * photo pool, db.ts's resolveThisWeekImage() for where this plugs into the
 * real weekly resolution (holiday pool wins when active and non-empty for
 * this town, season pool otherwise -- warn, never throw, on an active-but-
 * empty holiday). Kept DB-free and pure for the same reason lib/this-week-
 * images.ts is: real behavior (window math across years, overlap tie-
 * break, the 60-day rule) needs to be unit-testable without a database.
 */
import type { HolidayDefinition, HolidayId, HolidayImage } from '../config/holidays';
import type { Town } from '../config/category-images';
import { stableHash, type ThisWeekUsageRecord } from './this-week-images';

export interface DateYMD { y: number; m: number; d: number; }

function toUTCDate(ymd: DateYMD): Date {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
}

function fromUTCDate(date: Date): DateYMD {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function addDaysYMD(ymd: DateYMD, days: number): DateYMD {
  return fromUTCDate(new Date(toUTCDate(ymd).getTime() + days * 86_400_000));
}

/** Anonymous Gregorian algorithm for the Easter Sunday date (the
 *  Lichtenberg variant, which handles the full Gregorian range without the
 *  century-table special-casing the simpler h/l/m form needs) -- the one
 *  real movable feast this pool needs. An EARLIER version of this function
 *  used that simpler h/l/m/month/day formula from memory and was
 *  structurally wrong (not an arithmetic slip -- verified by hand against
 *  year 2000's real Easter date, April 23, which it computed as January
 *  11). This version is hand-verified against four known real dates in
 *  holidays.test.ts: 2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28. */
function easterDate(year: number): DateYMD {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const g = Math.floor((8 * b + 13) / 25);
  const h = (19 * a + b - d - g + 15) % 30;
  const j = Math.floor(c / 4);
  const k = c % 4;
  const m = Math.floor((a + 11 * h) / 319);
  const r = (2 * e + 2 * j - k - h + m + 32) % 7;
  const month = Math.floor((h - m + r + 90) / 25);
  const day = (h - m + r + month + 19) % 32;
  return { y: year, m: month, d: day };
}

/** The Nth occurrence of `weekday` (0=Sunday) in `month`/`year`; `n`
 *  negative counts from the end of the month (n=-1 is the LAST occurrence).
 *  n=0 is not valid (not checked -- every real call site uses a fixed,
 *  hand-written n). */
function nthWeekdayDate(year: number, month: number, weekday: number, n: number): DateYMD {
  if (n > 0) {
    const firstOfMonth = toUTCDate({ y: year, m: month, d: 1 });
    const offset = (weekday - firstOfMonth.getUTCDay() + 7) % 7;
    return { y: year, m: month, d: 1 + offset + 7 * (n - 1) };
  }
  const nextMonthFirst = month === 12 ? { y: year + 1, m: 1, d: 1 } : { y: year, m: month + 1, d: 1 };
  const lastOfMonth = addDaysYMD(nextMonthFirst, -1);
  const lastWeekday = toUTCDate(lastOfMonth).getUTCDay();
  const lastOccurrence = addDaysYMD(lastOfMonth, -((lastWeekday - weekday + 7) % 7));
  return addDaysYMD(lastOccurrence, 7 * (n + 1));
}

export function computeHolidayDate(rule: HolidayDefinition['dateRule'], year: number): DateYMD {
  if (rule.kind === 'fixed') return { y: year, m: rule.month, d: rule.day };
  if (rule.kind === 'easter') return easterDate(year);
  return nthWeekdayDate(year, rule.month, rule.weekday, rule.n);
}

export interface DateRange { start: DateYMD; end: DateYMD; }

/** The window opens `windowDays` before the holiday's own date and runs
 *  through the date itself (inclusive) -- see HolidayDefinition's own
 *  comment. Can legitimately start in the PREVIOUS calendar year (e.g.
 *  New Year's Day, windowDays=3 -> Dec 29 through Jan 1). */
export function holidayWindow(def: HolidayDefinition, year: number): DateRange {
  const date = computeHolidayDate(def.dateRule, year);
  return { start: addDaysYMD(date, -def.windowDays), end: date };
}

function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return toUTCDate(a.start).getTime() <= toUTCDate(b.end).getTime()
      && toUTCDate(b.start).getTime() <= toUTCDate(a.end).getTime();
}

export interface ActiveHolidayMatch {
  holiday: HolidayId;
  holidayDate: DateYMD;
}

/**
 * Which ACTIVE holiday's window (if any) overlaps the week [weekMonday,
 * weekSunday] -- checks each holiday's window instance for year-1/year/
 * year+1 (cheap and avoids having to reason about which year a window
 * might cross into) and returns the one whose OWN DATE is closest to the
 * week's Monday when more than one window overlaps (e.g. two holidays with
 * long windows close together) -- a week is only ever "about" the nearer
 * holiday, not an arbitrary declaration-order pick. Returns null when no
 * active holiday's window overlaps this week at all (the normal case,
 * most of the year).
 */
export function resolveActiveHoliday(
  holidays: HolidayDefinition[],
  weekMonday: DateYMD,
  weekSunday: DateYMD,
): ActiveHolidayMatch | null {
  const weekRange: DateRange = { start: weekMonday, end: weekSunday };
  const candidates: ActiveHolidayMatch[] = [];
  for (const def of holidays) {
    if (!def.active) continue;
    for (const year of [weekMonday.y - 1, weekMonday.y, weekMonday.y + 1]) {
      const window = holidayWindow(def, year);
      if (rangesOverlap(weekRange, window)) {
        candidates.push({ holiday: def.id, holidayDate: window.end });
      }
    }
  }
  if (candidates.length === 0) return null;
  const mondayMs = toUTCDate(weekMonday).getTime();
  candidates.sort((a, b) =>
    Math.abs(toUTCDate(a.holidayDate).getTime() - mondayMs) - Math.abs(toUTCDate(b.holidayDate).getTime() - mondayMs));
  return candidates[0];
}

/** The number of this town's holiday-pool images that would actually serve
 *  `monday`..`sunday` -- 0 when no holiday is active for the week, or when
 *  one is active but its pool for this town is still empty (the one case
 *  where the real resolver -- db.ts's resolveThisWeekImage() -- falls
 *  through to the season pool too, so season emptiness still matters
 *  there). Used by build-checks.ts's season-pool coverage/size guardrails
 *  so a week the real rotation would actually serve from an active holiday
 *  pool never gets blamed on an empty season pool it was never going to
 *  use (2026-10-07 review instruction: those checks used to be entirely
 *  holiday-blind -- confirmed by simulating Dec 7 2026, w50, against an
 *  empty winter pool and the real applied Christmas pool: the coverage
 *  check reported zero forward coverage and would have thrown, despite
 *  the Christmas pool already covering w50-w52). */
export function holidayPoolSizeForWeek(
  holidays: HolidayDefinition[],
  holidayImages: HolidayImage[],
  townId: string,
  monday: DateYMD,
  sunday: DateYMD,
): number {
  const match = resolveActiveHoliday(holidays, monday, sunday);
  if (!match) return 0;
  return holidayImages.filter(
    (img) => img.holiday === match.holiday && img.town_ids.includes(townId as Town),
  ).length;
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/** Same algorithm as this-week-images.ts's selectThisWeekImage(), adapted
 *  to a holiday pool (one holiday per image, not an array of seasons) --
 *  same 60-day no-repeat rule, same history table, same deterministic
 *  tie-break hash, so a holiday week behaves exactly like a season week
 *  from the rotation's point of view, just drawing from a different pool. */
export function selectHolidayImage(
  pool: HolidayImage[],
  townId: string,
  holiday: HolidayId,
  history: ThisWeekUsageRecord[],
  isoYearWeek: string,
  now: Date,
): string | null {
  const eligible = pool.filter((img) => img.town_ids.includes(townId as Town) && img.holiday === holiday);
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
  const pick = tied[stableHash(`${townId}:${isoYearWeek}:holiday`) % tied.length];
  return pick.id;
}

export interface HolidayPoolCheck {
  holiday: HolidayId;
  windowStart: DateYMD;
  poolSize: number;
}

/**
 * Per-town pool-size audit for every ACTIVE holiday whose window starts
 * within `daysBeforeWindow` days from now -- the holiday equivalent of
 * this-week-images.ts's seasonPoolSizes(), same "warn with real runway
 * before the rotation actually needs it" reasoning. Only ever looks
 * forward (today's year and the next), since a window that already
 * started or passed isn't "due soon" anymore.
 */
export function holidayPoolSizesDueSoon(
  holidays: HolidayDefinition[],
  pool: HolidayImage[],
  townId: string,
  today: DateYMD,
  daysBeforeWindow: number,
): HolidayPoolCheck[] {
  const results: HolidayPoolCheck[] = [];
  const todayMs = toUTCDate(today).getTime();
  for (const def of holidays) {
    if (!def.active) continue;
    for (const year of [today.y, today.y + 1]) {
      const window = holidayWindow(def, year);
      const daysUntilWindow = Math.round((toUTCDate(window.start).getTime() - todayMs) / 86_400_000);
      if (daysUntilWindow >= 0 && daysUntilWindow <= daysBeforeWindow) {
        const poolSize = pool.filter(
          (img) => img.town_ids.includes(townId as Town) && img.holiday === def.id,
        ).length;
        results.push({ holiday: def.id, windowStart: window.start, poolSize });
      }
    }
  }
  return results;
}
