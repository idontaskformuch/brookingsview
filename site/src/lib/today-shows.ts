/** Ticketmaster shows on /today (owner 2026-10-28, Glasgow Q3: the page listed only organisers' calendars, so a sold-out arena night was missing).
 *  At most MAX_TODAY_SHOWS shows in the city itself (no regional away-shows), the same title at the same venue counted once, best venue
 *  tier first. The browser still decides Tonight/Tomorrow from data-start/data-end, like every other candidate. */
import { rankTicketmasterEvents, dropEnded, ticketmasterSlug } from './whats-on';
import { distanceLabel, type TicketmasterFeedItem } from './ticketmaster';
import { bucketOf } from './local-day';
import { showTimeGb } from './whats-on-dates';

export const MAX_TODAY_SHOWS = 3;
/** A Ticketmaster listing has a start and no end; it counts as on for this long (the same 3 h rule as other events without an end). */
const SHOW_LENGTH_MS = 3 * 3_600_000;

export interface TodayShow {
  title: string;
  href: string;
  venue: string;
  start: string;
  end: string;
  clock: string;
}

export function selectTodayShows(items: TicketmasterFeedItem[], now: Date, timeZone: string, townId: string, cityName: string, max = MAX_TODAY_SHOWS): TodayShow[] {
  const seen = new Set<string>();
  const picked: TodayShow[] = [];
  for (const { item } of rankTicketmasterEvents(dropEnded(items, now), townId)) {
    const e = item.ticketmasterEvent;
    if (!item.occurs_at || distanceLabel(e.venueDistanceMiles, cityName) !== `In ${cityName}`) continue;
    const end = new Date(new Date(item.occurs_at).getTime() + SHOW_LENGTH_MS).toISOString();
    if (!bucketOf({ start: item.occurs_at, end }, now, timeZone)) continue;
    const key = `${e.title}|${e.venueName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ title: e.title, href: `/whats-on/${ticketmasterSlug(e)}/`, venue: e.venueName ?? 'Venue TBA', start: item.occurs_at, end, clock: showTimeGb(item.occurs_at, timeZone) });
    if (picked.length === max) break;
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start));
}
