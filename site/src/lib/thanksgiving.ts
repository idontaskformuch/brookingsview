/** Thanksgiving page (US towns): date helpers. Dependency-free and pure.
 *
 *  The page's FACTS (which services close, trash rules) are the 2026 ones in config/thanksgiving.ts, read from each
 *  town's own pages. The page is therefore indexable only around that holiday (THANKSGIVING_PAGE_YEAR, the week
 *  after it is the last day), then noindex until someone refreshes the config for the next year. */

export const THANKSGIVING_PAGE_YEAR = 2026;
/** The page stays indexable until this many days after Thanksgiving Day. */
export const INDEXABLE_DAYS_AFTER = 7;

const DAY = 86_400_000;

/** Thanksgiving Day (fourth Thursday of November) as a UTC-midnight day number. */
export function thanksgivingDay(year: number): number {
  const first = Date.UTC(year, 10, 1);
  const offset = (4 - new Date(first).getUTCDay() + 7) % 7;
  return first + offset * DAY + 3 * 7 * DAY;
}

/** The Monday of the week that contains Thanksgiving Day. */
export function thanksgivingWeekMonday(year: number): number {
  const t = thanksgivingDay(year);
  return t - 3 * DAY; // Thursday - 3 days
}

/** True once the page's 2026 facts are stale: noindex from the end of the window. */
export function isPastThanksgivingWindow(nowMs: number): boolean {
  return nowMs >= thanksgivingDay(THANKSGIVING_PAGE_YEAR) + INDEXABLE_DAYS_AFTER * DAY;
}

/** True from the start of November through the end of the window: when other pages may link to it. */
export function isThanksgivingSeason(nowMs: number): boolean {
  const start = Date.UTC(THANKSGIVING_PAGE_YEAR, 10, 1);
  return nowMs >= start && !isPastThanksgivingWindow(nowMs);
}
