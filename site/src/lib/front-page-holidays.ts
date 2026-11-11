/** The holidays the front-page selector can lead with: the town's holiday pages (config/holiday-pages), each as local day numbers for the
 *  years around `year` so a window that crosses New Year is seen. The selector decides which of them is inside its window. */
import { holidayPagesForTown } from '../config/holiday-pages/registry';
import { occurrenceDay } from './holiday-calendar';
import { closedPlaces, countHeld } from './holiday-view';
import type { FrontPageHoliday } from './front-page';

const DAY = 86_400_000;

export function frontPageHolidays(townId: string, year: number): FrontPageHoliday[] {
  return holidayPagesForTown(townId).flatMap(({ def, page }) =>
    [year - 1, year, year + 1].map((y) => ({
      slug: def.slug, label: def.label, day: occurrenceDay(def, y) / DAY, url: `/${def.slug}/`,
      // Only the season the page's facts are for says how many places are closed.
      // Only places shut on the day itself, and none while the town's own closures row is unconfirmed (owner 2026-11-11).
      closed: page.year === y && !countHeld(page) ? closedPlaces(page, new Date(occurrenceDay(def, y)).toISOString().slice(0, 10)) : null,
    })));
}
