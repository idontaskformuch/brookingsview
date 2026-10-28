import { describe, expect, it } from 'vitest';
import { selectTodayShows } from './today-shows';
import type { TicketmasterFeedItem } from './ticketmaster';

const show = (id: string, title: string, venue: string, at: string, miles: number | null = 1): TicketmasterFeedItem => ({
  sourceKind: 'ticketmaster',
  occurs_at: at,
  ticketmasterEvent: {
    id, title, attractionId: null, venueId: venue, venueName: venue, venueLatitude: null, venueLongitude: null, venueAddress: null, venueCity: null,
    venueStateCode: null, venuePostalCode: null, venueDistanceMiles: miles, ticketUrl: 'https://t.test', imageUrl: null, imageWidth: null, imageHeight: null,
    priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
  },
});
const NOW = new Date('2026-10-28T14:00:00Z');
const run = (items: TicketmasterFeedItem[]) => selectTodayShows(items, NOW, 'Europe/London', 'glasgow', 'Glasgow');

describe('selectTodayShows (/today, Glasgow)', () => {
  it('keeps in-city shows today or tomorrow, drops away shows, other days and ended ones', () => {
    const r = run([
      show('1', 'Tonight Band', 'OVO Hydro', '2026-10-28T19:00:00Z'),
      show('2', 'Tomorrow Band', 'SEC Armadillo', '2026-10-29T19:30:00Z'),
      show('3', 'Away Band', 'Far Arena', '2026-10-28T19:00:00Z', 40),
      show('4', 'Next Week Band', 'OVO Hydro', '2026-11-04T19:00:00Z'),
      show('5', 'Morning Show', 'OVO Hydro', '2026-10-28T08:00:00Z'),
    ]);
    expect(r.map((s) => s.title)).toEqual(['Tonight Band', 'Tomorrow Band']);
    expect(r[0].clock).toBe('7pm');
    expect(r[1].clock).toBe('7:30pm');
    expect(r[0].href).toMatch(/^\/whats-on\/.+\/$/);
  });
  it('counts the same title at the same venue once and never returns more than 3', () => {
    const items = [
      show('a', 'Same', 'OVO Hydro', '2026-10-28T18:00:00Z'), show('b', 'Same', 'OVO Hydro', '2026-10-28T20:00:00Z'),
      show('c', 'Two', 'OVO Hydro', '2026-10-28T19:00:00Z'), show('d', 'Three', 'OVO Hydro', '2026-10-28T19:30:00Z'),
      show('e', 'Four', 'OVO Hydro', '2026-10-29T19:00:00Z'),
    ];
    const r = run(items);
    expect(r).toHaveLength(3);
    expect(r.filter((s) => s.title === 'Same')).toHaveLength(1);
  });
});
