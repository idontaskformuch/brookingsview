/** The holidays the front-page selector can lead with: the town's holiday pages (config/holiday-pages), each as local day numbers for the
 *  years around `year` so a window that crosses New Year is seen. The selector decides which of them is inside its window. */
import { holidayPagesForTown } from '../config/holiday-pages/registry';
import { occurrenceDay } from './holiday-calendar';
import { closedPlaces } from './holiday-view';
import type { FrontPageHoliday } from './front-page';

const DAY = 86_400_000;

export function frontPageHolidays(townId: string, year: number): FrontPageHoliday[] {
  return holidayPagesForTown(townId).flatMap(({ def, page }) =>
    [year - 1, year, year + 1].map((y) => ({
      slug: def.slug, label: def.label, day: occurrenceDay(def, y) / DAY, url: `/${def.slug}/`,
      // Only the season the page's facts are for says how many places are closed.
      closed: page.year === y ? closedPlaces(page) : null,
    })));
}
