/** Veterans Day page (Broomfield only): date helpers. Dependency-free and pure.
 *
 *  The page's FACTS are the 2026 ones in config/holiday-pages/veterans-day.ts (city notice read 2026-11-04). The page
 *  is indexable from Nov 1 through Nov 12 2026 (owner 2026-11-04: only the days when someone asks what is closed on
 *  the 11th), then noindex until someone refreshes the config for the next year. */

export const VETERANS_DAY_PAGE_YEAR = 2026;

const DAY = 86_400_000;
/** Veterans Day itself, UTC midnight. */
export const VETERANS_DAY = Date.UTC(VETERANS_DAY_PAGE_YEAR, 10, 11);
/** First indexable day and the first day after the window (indexable through Nov 12). */
export const VETERANS_DAY_WINDOW_START = Date.UTC(VETERANS_DAY_PAGE_YEAR, 10, 1);
export const VETERANS_DAY_WINDOW_END = VETERANS_DAY + 2 * DAY;

/** True while the page's 2026 facts are not (yet) or no longer current: noindex. */
export function isOutsideVeteransDayWindow(nowMs: number): boolean {
  return nowMs < VETERANS_DAY_WINDOW_START || nowMs >= VETERANS_DAY_WINDOW_END;
}
