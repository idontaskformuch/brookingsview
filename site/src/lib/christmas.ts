/** Christmas page (Glasgow only so far): date helpers. Dependency-free and pure.
 *
 *  The page's FACTS are the 2026 ones in config/holiday-pages/christmas.ts. Owner rule 2026-11-04 for every
 *  Christmas window: it opens about six weeks BEFORE the first confirmed event (people plan ahead), not when the
 *  event starts, and closes after the last run ends. Glasgow: first event Fri 6 Nov 2026 (St Enoch Square opens)
 *  -> open from Fri 25 Sep 2026; last day Sun 3 Jan 2027 (Glasgow Green). Noindex outside the window until
 *  someone refreshes the config for the next year. */

export const CHRISTMAS_PAGE_YEAR = 2026;

/** First indexable day (UTC midnight) and the first day after the window. */
const DAY = 86_400_000;
export const CHRISTMAS_LEAD_DAYS = 42;
export const CHRISTMAS_FIRST_EVENT = Date.UTC(2026, 10, 6);
export const CHRISTMAS_WINDOW_START = CHRISTMAS_FIRST_EVENT - CHRISTMAS_LEAD_DAYS * DAY;
export const CHRISTMAS_WINDOW_END = Date.UTC(2027, 0, 4);

/** True while the page's 2026 facts are not (yet) or no longer current: noindex. */
export function isOutsideChristmasWindow(nowMs: number): boolean {
  return nowMs < CHRISTMAS_WINDOW_START || nowMs >= CHRISTMAS_WINDOW_END;
}
