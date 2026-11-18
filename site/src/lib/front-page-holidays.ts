/** The holidays the front-page selector can lead with: the town's holiday pages (config/holiday-pages), each as local day numbers for the
 *  years around `year` so a window that crosses New Year is seen. The selector decides which of them is inside its window. A page's own
 *  extra posts (`frontPage`, e.g. Glasgow's "Hogmanay and New Year") come with their own visible days and link to an anchor on the page. */
import { holidayPagesForTown } from '../config/holiday-pages/registry';
import { occurrenceDay } from './holiday-calendar';
import { closedPlaces, countHeld, holidayInsights } from './holiday-view';
import type { FrontPageHoliday } from './front-page';

const DAY = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;

export function frontPageHolidays(townId: string, year: number): FrontPageHoliday[] {
  return holidayPagesForTown(townId).flatMap(({ def, page }) => [
    ...[year - 1, year, year + 1].map((y) => ({
      slug: def.slug, label: def.label, day: occurrenceDay(def, y) / DAY, url: `/${def.slug}/`,
      // Only the season the page's facts are for says how many places are closed.
      // Only places shut on the day itself, and none while the town's own closures row is unconfirmed (owner 2026-11-11).
      closed: page.year === y && !countHeld(page) ? closedPlaces(page, new Date(occurrenceDay(def, y)).toISOString().slice(0, 10)) : null,
      // Only the season the page's facts are for has insight lines (the selector drops them once the day is past).
      insights: page.year === y ? holidayInsights(page) : [],
    })),
    ...(page.frontPage ?? []).map((p) => ({
      slug: `${def.slug}#${p.anchor}`, label: p.label, day: dayNumber(p.deckDays[0]?.date ?? p.from), url: `/${def.slug}/#${p.anchor}`, closed: null,
      window: { from: dayNumber(p.from), to: dayNumber(p.to) },
      deckDays: p.deckDays.map((d) => ({ label: d.label, day: dayNumber(d.date) })),
    })),
  ]);
}
