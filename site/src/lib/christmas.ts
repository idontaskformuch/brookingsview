/** Christmas page (Glasgow only so far): date helpers. Dependency-free and pure.
 *
 *  The page's FACTS are the 2026 ones in config/holiday-pages/christmas.ts. Owner-approved window 2026-11-04:
 *  indexable from Fri 6 Nov 2026 (St Enoch Square opens) through Sun 3 Jan 2027 (Glasgow Green's last day),
 *  noindex outside it until someone refreshes the config for the next year. */

export const CHRISTMAS_PAGE_YEAR = 2026;

/** First indexable day (UTC midnight) and the first day after the window. */
export const CHRISTMAS_WINDOW_START = Date.UTC(2026, 10, 6);
export const CHRISTMAS_WINDOW_END = Date.UTC(2027, 0, 4);

/** True while the page's 2026 facts are not (yet) or no longer current: noindex. */
export function isOutsideChristmasWindow(nowMs: number): boolean {
  return nowMs < CHRISTMAS_WINDOW_START || nowMs >= CHRISTMAS_WINDOW_END;
}
