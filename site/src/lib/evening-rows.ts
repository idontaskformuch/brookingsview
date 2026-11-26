/** An evening entry (lib/evening-items.ts, /tonight) as the shared row data (lib/event-row.ts EventRowData), so /tonight's evenings use the
 *  same day block as /events/ and /this-week/ (owner 2026-11-26 (10), rollout b): a digest line, one featured event from the town, compact
 *  rows, then the Nearby block. Pure. */
import type { EveningEntry } from './evening-items';
import { cleanCity } from './evening-items';
import type { EventRowData } from './event-row';
import { eveningCategory } from './pop-categories';
import { showTimeGb } from './whats-on-dates';
import { TICKET_LINK_REL } from './whats-on';

/** In another town: the source states another venue city, or (no city stated) a drive time was worked out from a stated distance. */
export function isNearbyEntry(e: Pick<EveningEntry, 'venueCity' | 'driveMinutes'>, homeCity: string): boolean {
  const city = cleanCity(e.venueCity);
  if (city) return city.toLowerCase() !== homeCity.trim().toLowerCase();
  return e.driveMinutes != null;
}

export function eveningRow(e: EveningEntry, homeCity: string, tz: string): EventRowData {
  const nearby = isNearbyEntry(e, homeCity);
  const city = cleanCity(e.venueCity);
  return {
    start: e.start, end: e.end, time: e.hours ?? showTimeGb(e.start, tz), title: e.title, href: e.href ?? null,
    rel: e.source === 'ticketmaster' ? TICKET_LINK_REL : e.href && !e.href.startsWith('/') ? 'noopener' : null,
    place: [e.venue, nearby ? city : e.area].filter((v): v is string => !!v),
    extra: [...e.labels.filter((l) => l !== 'Free'), ...(e.labels.includes('Free') ? ['Free'] : [])],
    category: eveningCategory(e.group),
    ...(e.recurring ? { recurring: true } : {}),
    ...(nearby ? { nearby: { city, ticket: e.source === 'ticketmaster' } } : {}),
  };
}
