/** A holiday page with the rows added at build time: the town's own event calendars, the venue register and (on a season page)
 *  Ticketmaster (lib/holiday-calendar-events.ts). One function, so /<holiday>/ and the evening layer's holiday group
 *  (lib/evening-season.ts) read the same rows. Reads the database; the matches are printed to the build log when `log` is set. */
import { siteConfig } from './site-config';
import { calendarExcludesFor, calendarIncludesFor, type HolidayPageEntry } from '../config/holiday-pages/registry';
import { getEveningRegister, getFacilities, getUpcomingStories } from './db';
import { buildTownEventsView } from './events-town-view';
import { formatCalendarReport, matchCalendarEvents, matchRegisterRows, matchTicketmasterEvents } from './holiday-calendar-events';
import { getTicketmasterEventsForTown } from './ticketmaster';
import type { HolidayPageData } from './holiday-page';
import type { EveningEntry } from './evening-items';
import { openHolidayPages, seasonEveningEntries } from './evening-season';

export async function holidayPageWithRows(entry: HolidayPageEntry, nowMs: number, log = false): Promise<HolidayPageData> {
  let page = entry.page;
  const exclude = calendarExcludesFor(entry.def.slug, siteConfig.townId);
  if (!exclude) return page;
  // The same rows /events/ shows (frozen filter, merge, in-town / nearby), with room for the whole window.
  const [stories, facilities] = await Promise.all([getUpcomingStories(['event'], 600), getFacilities()]);
  const { displayed, distanceOf, nearbyRows } = buildTownEventsView(stories, [], facilities);
  const nearby = new Set(nearbyRows.map((r) => r.item));
  const { events, report } = matchCalendarEvents(
    entry.def, entry.page.year,
    displayed.map((item) => (nearby.has(item) ? { item, nearbyMiles: distanceOf.get(item) ?? null } : { item })),
    siteConfig.timezone, exclude, calendarIncludesFor(entry.def.slug, siteConfig.townId),
  );
  const reg = page.season
    ? matchRegisterRows(entry.def, entry.page.year, await getEveningRegister(), nowMs, siteConfig.timezone, siteConfig.cityName, exclude)
    : { events: [], report: [] };
  // Ticketmaster: the build's shared fetch (no extra call), on a season page only (owner 2026-11-15).
  const tm = page.season && siteConfig.hasWhatsOn
    ? matchTicketmasterEvents(entry.def, entry.page.year, await getTicketmasterEventsForTown(siteConfig), nowMs, siteConfig.timezone, exclude)
    : { events: [], report: [] };
  // A row the page already has by hand (same organizer page) is not listed twice.
  const handUrls = new Set(page.events.flatMap((e) => (e.status === 'confirmed' ? [e.url] : [])));
  const added = [...events, ...reg.events, ...tm.events].filter((e) => !handUrls.has(e.url));
  if (log) for (const line of formatCalendarReport(entry.def.slug, siteConfig.townId, [...report, ...reg.report, ...tm.report])) console.log(line);
  if (added.length > 0) page = { ...page, events: [...page.events, ...added] };
  return page;
}

/** The evening layer's rows plus the holiday group's (every open holiday page of the town), in start order. Both /tonight and
 *  /this-weekend call this, so the threshold sees the same rows whichever page is built first. */
export async function withSeasonEntries(entries: EveningEntry[], now: Date, timezone: string): Promise<EveningEntry[]> {
  const sources = await Promise.all(openHolidayPages(siteConfig.townId, now.getTime(), timezone).map(async (entry) => ({
    label: entry.def.label, href: `/${entry.def.slug}/`, page: await holidayPageWithRows(entry, now.getTime()),
  })));
  const season = seasonEveningEntries(sources, entries, { now, timezone });
  if (season.length > 0) console.log(`[evening-season] ${siteConfig.townId}: ${season.length} holiday row(s) in ${[...new Set(season.map((e) => e.season!.label))].join(', ')}`);
  return [...entries, ...season].sort((a, b) => a.start.localeCompare(b.start));
}
