/** "Big shows nearby" (owner 2026-11-06, Broomfield): Ticketmaster concerts, sport and touring shows at venues within a set number of miles,
 *  shown as their own module and never mixed with the town's own events. Nothing here is imported by the local event pipeline
 *  (events-town-view.ts), so a big show can never reach "N things on today", the day strip or the local lists (big-shows.test.ts guards that).
 *  The question it answers: "which big shows can I get to from here?" -- not "what is on in <town>". Price is hidden until we know what
 *  Ticketmaster's priceRanges contain (fees in or out). */
import type { TicketmasterFeedItem } from './ticketmaster';
import { getTicketmasterEventsForTown } from './ticketmaster';
import { distanceMetres } from './tonight-cards';
import { hasEnded, localDayNumber } from './local-day';
import { showTimeGb } from './whats-on-dates';
import type { Category } from './ui/ui-helpers';

export interface BigShowsConfig { enabled: boolean; maxMiles: number; horizonDays?: number }

export interface BigShow {
  id: string;
  title: string;
  /** ISO instant of the first (or only) date shown. */
  start: string;
  dateLabel: string;
  timeLabel: string;
  venue: string | null;
  city: string | null;
  /** Whole straight-line miles from the town centre. */
  miles: number;
  href: string;
  cat: Category | null;
  /** Further dates of the same show at the same venue, folded into this row. */
  moreDates: number;
}

const METERS_PER_MILE = 1609.344;
export const BIG_SHOWS_HORIZON_DAYS = 60;

/** Library category for Ticketmaster's own segment; null = drawn neutral. */
export function bigShowCategory(segment: string | null | undefined): Category | null {
  const s = (segment ?? '').toLowerCase();
  if (s === 'music') return 'music';
  if (s === 'sports') return 'sports';
  if (s === 'arts & theatre') return 'arts';
  return null;
}

/** "Denver · 13 mi": the venue's own city and straight-line miles. Without a stated city only the miles. */
export function bigShowWhere(s: Pick<BigShow, 'venue' | 'city' | 'miles'>): string {
  return [s.venue, [s.city, `${s.miles < 1 ? '<1' : s.miles} mi`].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
}

export function buildBigShows(
  items: TicketmasterFeedItem[],
  o: { center: { lat: number; lon: number }; maxMiles: number; now: Date; timezone: string; locale?: string; horizonDays?: number },
): BigShow[] {
  const today = localDayNumber(o.now, o.timezone);
  const horizon = o.horizonDays ?? BIG_SHOWS_HORIZON_DAYS;
  const dayFmt = new Intl.DateTimeFormat(o.locale ?? 'en-US', { timeZone: o.timezone, weekday: 'short', month: 'short', day: 'numeric' });
  const rows: BigShow[] = [];
  for (const item of items) {
    const e = item.ticketmasterEvent;
    if (!item.occurs_at || !e.ticketUrl) continue;
    const start = new Date(item.occurs_at);
    if (hasEnded({ start: item.occurs_at, end: null }, o.now, o.timezone)) continue;
    if (localDayNumber(start, o.timezone) - today > horizon) continue;
    // straight-line miles from the town centre; the venue's own coordinates first, Ticketmaster's stated distance second, otherwise not shown
    const miles = e.venueLatitude != null && e.venueLongitude != null
      ? distanceMetres(o.center, { lat: e.venueLatitude, lon: e.venueLongitude }) / METERS_PER_MILE
      : e.venueDistanceMiles;
    if (miles == null || miles > o.maxMiles) continue;
    rows.push({
      id: e.id, title: e.title, start: item.occurs_at, dateLabel: dayFmt.format(start), timeLabel: showTimeGb(item.occurs_at, o.timezone),
      venue: e.venueName, city: e.venueCity, miles: Math.round(miles), href: e.ticketUrl, cat: bigShowCategory(e.segment), moreDates: 0,
    });
  }
  rows.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  // a tour stop played on several dates at one venue is one row (earliest date) with "+N more dates"
  const out: BigShow[] = [];
  const seen = new Map<string, BigShow>();
  for (const r of rows) {
    const key = `${r.title.toLowerCase()}|${(r.venue ?? '').toLowerCase()}`;
    const first = seen.get(key);
    if (first) { first.moreDates++; continue; }
    seen.set(key, r);
    out.push(r);
  }
  return out;
}

/** Loads Ticketmaster at the module's own radius (a second request per build: the town's `ticketmaster.radiusMiles` serves What's On and /tonight). */
export async function getBigShows(
  site: { bigShows?: BigShowsConfig; ticketmaster?: { enabled: boolean; latitude: number; longitude: number; radiusMiles: number }; townCenter: { lat: number; lon: number }; timezone: string },
  now = new Date(),
): Promise<BigShow[]> {
  if (!site.bigShows?.enabled || !site.ticketmaster?.enabled) return [];
  const items = await getTicketmasterEventsForTown({ ticketmaster: { ...site.ticketmaster, radiusMiles: site.bigShows.maxMiles } }, { includeSports: true });
  return buildBigShows(items, { center: site.townCenter, maxMiles: site.bigShows.maxMiles, now, timezone: site.timezone, horizonDays: site.bigShows.horizonDays });
}
