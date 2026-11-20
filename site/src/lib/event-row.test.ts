import { describe, expect, it } from 'vitest';
import { rowFromTicketmaster, rowFromFeedItem, rowEnvFor, groupByDay, mixedCategories, dayKey } from './event-row';
import { makeRowFacts } from './event-row-facts';
import { eventClock, dayTimeKicker } from './time';
import type { TicketmasterFeedItem } from './ticketmaster';
import type { FeedItem } from './events';
import type { SdsuEvent } from './db';

// Real rows (CLAUDE.md 15), Brookings, read from the /whats-on/ JSON-LD and /today/ on 2026-11-20:
//  - Ticketmaster Z7r9jZ1A7q3eb "Casey Donahew", The District, startDate 2026-11-21T02:00:00Z. venueDistanceMiles is the one field set
//    by hand (not in the JSON-LD): 55, the page's "~55 miles away".
//  - Ticketmaster vv17bZ_4GkRwDugz "Autumn Festival", Sioux Falls Convention Center, 2026-11-20T17:00:00Z, a 3-date run to Sun Nov 22.
//    lastOccursAt is the one field set by hand: the same clock on Nov 22 (the page says "3 dates, Fri, Nov 20 – Sun, Nov 22").
//  - SDSU arts event https://www.sdstate.edu/events/2026/11/grace-fromknect-recital "Grace Fromknect Recital", The Oscar Larson Performing
//    Arts Center, 2026-11-20T20:00:00Z. ends_at null and external_event_id are the fields set by hand.
const TZ = 'America/Chicago';
const NOW = new Date('2026-11-20T10:46:00Z');
const env = rowEnvFor({ timezone: TZ, cityName: 'Brookings', country: 'us' }, NOW);

const tm = (id: string, title: string, venue: string, at: string, miles: number | null): TicketmasterFeedItem => ({
  sourceKind: 'ticketmaster',
  occurs_at: at,
  ticketmasterEvent: {
    id, title, attractionId: null, venueId: venue, venueName: venue, venueLatitude: null, venueLongitude: null, venueAddress: null, venueCity: null,
    venueStateCode: null, venuePostalCode: null, venueDistanceMiles: miles, ticketUrl: `https://www.ticketmaster.com/event/${id}`, imageUrl: null,
    imageWidth: null, imageHeight: null, priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
  },
});
const casey = tm('Z7r9jZ1A7q3eb', 'Casey Donahew', 'The District', '2026-11-21T02:00:00Z', 55);
const autumn = tm('vv17bZ_4GkRwDugz', 'Autumn Festival', 'Sioux Falls Convention Center', '2026-11-20T17:00:00Z', 52);
const recital: FeedItem = {
  sourceKind: 'arts', occurs_at: '2026-11-20T20:00:00Z',
  event: {
    external_event_id: 'grace-fromknect-recital', title: 'Grace Fromknect Recital', teaser: null, location: 'The Oscar Larson Performing Arts Center',
    starts_at: '2026-11-20T20:00:00Z', ends_at: null, categories: null, primary_category: null,
    event_url: 'https://www.sdstate.edu/events/2026/11/grace-fromknect-recital',
  } as unknown as SdsuEvent,
};
const facts = makeRowFacts({ cityName: 'Brookings', facilities: [], areas: null });

describe('EventRow data (designsystem Fas 1)', () => {
  it('a Ticketmaster show: time, title, venue and distance; the day is not on the row', () => {
    const r = rowFromTicketmaster(casey, env);
    expect(r).toMatchObject({ time: '8 PM', title: 'Casey Donahew', place: ['The District', '~55 miles away'], extra: [] });
    expect(r.href).toBe('https://www.ticketmaster.com/event/Z7r9jZ1A7q3eb');
    expect(JSON.stringify(r)).not.toMatch(/Nov|Fri/);
  });
  it('a run claims no single time and says its dates', () => {
    const r = rowFromTicketmaster(autumn, env, 3, '2026-11-22T17:00:00Z');
    expect(r.time).toBe('');
    expect(r.extra[0]).toBe('3 dates, Fri, Nov 20 – Sun, Nov 22');
  });
  it('an arts event: venue from the source, link out, the category from the title', () => {
    const r = rowFromFeedItem(recital, env, facts);
    expect(r).toMatchObject({ time: '2 PM', title: 'Grace Fromknect Recital', place: ['The Oscar Larson Performing Arts Center'], rel: 'noopener', category: 'music' });
  });
  it('the UK clock and no all-day word come from the country profile', () => {
    const gb = rowEnvFor({ timezone: 'Europe/London', cityName: 'Glasgow', country: 'gb' }, NOW);
    expect(gb).toMatchObject({ lowerClock: true, allDayLabel: '', seriesPattern: true });
    expect(rowFromTicketmaster(casey, gb).time).toBe('2am');
  });
});

describe('DayGroup grouping', () => {
  it('one group per town day, the evening show on the town date (UTC is already the next day)', () => {
    const rows = [autumn, casey].map((i) => rowFromTicketmaster(i, env));
    const g = groupByDay(rows, env);
    expect(g.map((x) => [x.key, x.label, x.rows.length])).toEqual([['2026-11-20', 'Fri, Nov 20', 2]]);
    expect(dayKey('2026-11-21T02:00:00Z', TZ)).toBe('2026-11-20');
  });
  it('category only when the list mixes them', () => {
    expect(mixedCategories([{ category: 'music' }, { category: null }])).toBe(false);
    expect(mixedCategories([{ category: 'music' }, { category: 'arts' }])).toBe(true);
  });
});

describe('eventClock', () => {
  it('is dayTimeKicker without the day', () => {
    expect(eventClock('2026-11-20T20:00:00Z', TZ)).toBe('2 PM');
    expect(dayTimeKicker('2026-11-20T20:00:00Z', TZ)).toBe('Fri · 2 PM');
  });
});
