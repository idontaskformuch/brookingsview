import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBigShows, bigShowWhere, bigShowCategory, bigShowDays } from './big-shows';
import type { TicketmasterFeedItem } from './ticketmaster';
import { ticketmasterLocality } from './events';
import { buildEventsView, isOwnEvent } from './event-day-view';

const CENTER = { lat: 39.9205, lon: -105.0866 }; // Broomfield
const NOW = new Date('2026-11-10T18:00:00Z');
const TZ = 'America/Denver';

function tm(id: string, title: string, startsAt: string | null, o: Partial<TicketmasterFeedItem['ticketmasterEvent']> = {}): TicketmasterFeedItem {
  return {
    sourceKind: 'ticketmaster', occurs_at: startsAt,
    ticketmasterEvent: {
      id, title, attractionId: null, venueId: 'v1', venueName: 'Ball Arena', venueLatitude: 39.7487, venueLongitude: -105.0077, venueAddress: null,
      venueCity: 'Denver', venueStateCode: 'CO', venuePostalCode: null, venueDistanceMiles: null, ticketUrl: `https://www.ticketmaster.com/e/${id}`,
      imageUrl: null, imageWidth: null, imageHeight: null, priceRangeText: '$40 - $90', priceMin: 40, priceMax: 90, priceCurrency: 'USD',
      segment: 'Music', genre: 'Rock', ...o,
    },
  };
}
const build = (items: TicketmasterFeedItem[], maxMiles = 25) => buildBigShows(items, { center: CENTER, maxMiles, now: NOW, timezone: TZ });

describe('buildBigShows', () => {
  it('keeps shows within maxMiles of the town centre, drops those beyond it', () => {
    const near = tm('a', 'Near', '2026-11-20T02:00:00Z');
    const far = tm('b', 'Far', '2026-11-21T02:00:00Z', { venueLatitude: 40.6, venueLongitude: -105.1, venueCity: 'Fort Collins' }); // ~47 mi
    expect(build([near, far]).map((s) => s.title)).toEqual(['Near']);
  });
  it('uses Ticketmaster\'s stated distance when the venue has no coordinates, and drops a show with neither', () => {
    const stated = tm('a', 'Stated', '2026-11-20T02:00:00Z', { venueLatitude: null, venueLongitude: null, venueDistanceMiles: 12.4 });
    const none = tm('b', 'None', '2026-11-20T02:00:00Z', { venueLatitude: null, venueLongitude: null, venueDistanceMiles: null });
    const out = build([stated, none]);
    expect(out.map((s) => s.title)).toEqual(['Stated']);
    expect(out[0].miles).toBe(12);
  });
  it('sorts by date, not by anything else', () => {
    const out = build([tm('b', 'Zebra', '2026-12-05T02:00:00Z'), tm('a', 'Apple', '2026-11-12T02:00:00Z'), tm('c', 'Mango', '2026-11-30T02:00:00Z')]);
    expect(out.map((s) => s.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });
  it('drops shows that are over, beyond the horizon or without a start time', () => {
    const out = build([
      tm('a', 'Over', '2026-11-10T12:00:00Z'), tm('b', 'Later', '2027-03-01T02:00:00Z'), tm('c', 'NoTime', null), tm('d', 'Ok', '2026-11-11T02:00:00Z'),
    ]);
    expect(out.map((s) => s.title)).toEqual(['Ok']);
  });
  it('folds several dates of one show at one venue into the first row', () => {
    const out = build([tm('a', 'Disney On Ice', '2026-11-20T02:00:00Z'), tm('b', 'Disney On Ice', '2026-11-21T02:00:00Z'), tm('c', 'Disney On Ice', '2026-11-22T02:00:00Z')]);
    expect(out).toHaveLength(1);
    expect(out[0].moreDates).toBe(2);
  });
  it('includes sport, and carries no price', () => {
    const out = build([tm('a', 'Nuggets v Lakers', '2026-11-20T02:00:00Z', { segment: 'Sports', genre: 'Basketball' })]);
    expect(out).toHaveLength(1);
    expect(out[0].cat).toBe('sports');
    expect(Object.keys(out[0])).not.toContain('price');
    expect(JSON.stringify(out[0])).not.toMatch(/\$40|priceMin/);
  });
  it('writes "Venue · City · N mi"', () => {
    const [s] = build([tm('a', 'X', '2026-11-20T02:00:00Z')]);
    expect(bigShowWhere(s)).toMatch(/^Ball Arena · Denver · \d+ mi$/);
    expect(bigShowWhere({ venue: null, city: null, miles: 0 })).toBe('<1 mi');
  });
  it('maps Ticketmaster segments to library categories', () => {
    expect(bigShowCategory('Music')).toBe('music');
    expect(bigShowCategory('Arts & Theatre')).toBe('arts');
    expect(bigShowCategory('Miscellaneous')).toBeNull();
  });
});

describe('bigShowDays (the date-tile list)', () => {
  const shows = build([
    tm('a', 'Early', '2026-11-20T02:00:00Z'), tm('b', 'Late', '2026-11-20T04:00:00Z'), tm('c', 'Next day', '2026-11-22T02:00:00Z'),
    tm('d', 'Tour', '2026-12-01T02:00:00Z'), tm('e', 'Tour', '2026-12-02T02:00:00Z'),
  ]);
  it('groups by the local day of the town (02:00Z on the 20th is the evening of the 19th in Denver) and keeps the order', () => {
    const days = bigShowDays(shows, TZ);
    expect(days.map((d) => [d.dayKey, d.rows.map((r) => r.title)])).toEqual([
      ['2026-11-19', ['Early', 'Late']], ['2026-11-21', ['Next day']], ['2026-11-30', ['Tour']],
    ]);
  });
  it('a row links to Ticketmaster, reads "Venue · City · N mi" with the time first, and carries the folded dates and no price', () => {
    const [row] = bigShowDays(shows, TZ).flatMap((d) => d.rows).filter((r) => r.title === 'Tour');
    expect(row.href).toBe('https://www.ticketmaster.com/e/d');
    expect(row.venue).toBe('Ball Arena');
    expect(row.area).toMatch(/^Denver · \d+ mi$/);
    expect(row.note).toBe('+ 1 more date');
    expect(row.start).toBe('2026-12-01T02:00:00Z');
    expect(JSON.stringify(row)).not.toMatch(/\$40|price/i);
  });
  it('BigShowsNearby prints the shared date-tile list, not its own row component (BigShowRow is gone)', () => {
    const src = readFileSync(join(__dirname, '..', 'components/events/BigShowsNearby.astro'), 'utf8');
    expect(src).toMatch(/PopEventList/);
    expect(src).not.toMatch(/BigShowRow|data-hide-ended/);
  });
});

// Owner 2026-11-06: a big show is never counted with the town's own events. Owner 2026-11-26 (8), answer to the question about this
// rule: "I listor, inte i räknare" -- Ticketmaster listings are in /events/ and /this-week/ (same dedup, nearby rule, category), never in
// a count ("N things on today", the day strip, tonight, free, the header and front-page counts, the week's noindex count).
describe('Ticketmaster: in the lists, never in the counts', () => {
  const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
  // Real row: Broomfield /whats-on/ as built 2026-11-26 (JSON-LD): title, venue, start, coordinates, link ordagrant. genre: not in the
  // JSON-LD, left null.
  const prydz: TicketmasterFeedItem = tm('Z7r9jZ1AAZyOs', 'Eric Prydz (16+ Event)', '2026-11-28T04:00:00Z', {
    venueName: 'Mission Ballroom', venueCity: 'Denver', venueLatitude: 39.7896, venueLongitude: -104.9422,
    ticketUrl: 'https://www.ticketmaster.com/event/Z7r9jZ1AAZyOs', localDate: '2026-11-27', localTime: '21:00:00', segment: 'Music', genre: null,
    venueId: null, priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null, // not in the row: the helper's defaults cleared
  });
  it('the nearby rule: the venue city decides; Denver (12 mi) is nearby, beyond 25 mi is outside, Broomfield in town', () => {
    const near = ticketmasterLocality(prydz, 'Broomfield', 'broomfield_co', CENTER);
    expect(near.zone).toBe('nearby');
    expect(Math.round(near.distanceMiles!)).toBe(12);
    // Changed field: the city (Broomfield) -> in town; the coordinates (Colorado Springs, 39.8 -> 38.8339, -104.8214) -> outside.
    expect(ticketmasterLocality(tm('a', 'x', prydz.occurs_at, { ...prydz.ticketmasterEvent, venueCity: 'Broomfield' }), 'Broomfield', 'broomfield_co', CENTER).zone).toBe('in_town');
    expect(ticketmasterLocality(tm('a', 'x', prydz.occurs_at, { ...prydz.ticketmasterEvent, venueCity: 'Colorado Springs', venueLatitude: 38.8339, venueLongitude: -104.8214 }), 'Broomfield', 'broomfield_co', CENTER).zone).toBe('outside');
  });
  it('a Ticketmaster row is listed under its day, but the day count, today and tonight count only own events', () => {
    const view = buildEventsView([prydz], { now: new Date('2026-11-27T18:00:00Z'), timezone: TZ, gb: false, facts: () => ({ title: 'Eric Prydz (16+ Event)', venue: 'Mission Ballroom', area: null, free: false, kids: false }) });
    expect(view.days[0].rows.map((r) => r.title)).toEqual(['Eric Prydz (16+ Event)']);
    expect([view.days[0].count, view.todayCount, view.tonightCount, view.total]).toEqual([0, 0, 0, 0]);
    expect(isOwnEvent(prydz)).toBe(false);
  });
  it('the counters filter it: EventsGlance and the shared count (header ticker, /today/, front page) take own events only', () => {
    const glance = readFileSync(join(__dirname, '..', 'components/events/EventsGlance.astro'), 'utf8');
    expect(glance).toMatch(/\.filter\(\(r\) => isOwnEvent\(r\.item\)\)/);
    expect(read('events-town-view.ts')).toMatch(/t\.here\.filter\(\(e\) => isOwnEvent\(e\.item\)\)/);
    // The week's noindex count (lib/week-count.mjs, also the sitemap's) never reads Ticketmaster.
    expect(read('week-count.mjs')).not.toMatch(/ticketmaster/i);
  });
  it('/events/ lists a Ticketmaster show only within the page\'s own days (Broomfield was 56,000 px with 60 days of Denver shows)', () => {
    expect(read('events-town-view.ts')).toMatch(/const inWindow = \(r: DayRow\) => isOwnEvent\(r\.item\) \|\| r\.offset < DAY_WINDOW;/);
    expect(read('events-town-view.ts')).toMatch(/nearbyView\.furtherOut\]\.filter\(inWindow\)/);
  });
});
