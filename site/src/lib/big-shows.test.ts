import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBigShows, bigShowWhere, bigShowCategory, bigShowDays } from './big-shows';
import type { TicketmasterFeedItem } from './ticketmaster';

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

// Owner 2026-11-06: a big show is never counted with the town's own events. The local pipeline must not know about it.
describe('big shows stay out of the local event pipeline', () => {
  const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
  it('events-town-view, event-day-view and events.ts never import big-shows or Ticketmaster', () => {
    for (const f of ['events-town-view.ts', 'event-day-view.ts', 'events.ts']) {
      expect(read(f), f).not.toMatch(/big-shows|from '\.\/ticketmaster'/);
    }
  });
  it('EventsGlance (the "N things on today" hero) takes no big-show input', () => {
    const glance = readFileSync(join(__dirname, '..', 'components/events/EventsGlance.astro'), 'utf8');
    expect(glance).not.toMatch(/big-?shows|ticketmaster/i);
  });
});
