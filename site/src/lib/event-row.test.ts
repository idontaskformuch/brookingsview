import { describe, expect, it } from 'vitest';
import { rowFromTicketmaster, rowFromFeedItem, rowEnvFor, groupByDay, mixedCategories, dayKey, clockFromLocalTime } from './event-row';
import { normalizeTicketmasterEvent } from './ticketmaster';
import { weekendWindow, weekendShows } from './whats-on';
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

// Owner 2026-11-20: a US Ticketmaster row's day and time are the venue's own localDate/localTime, never re-derived from UTC. Real row,
// Moreno Valley /whats-on/ 2026-11-20: vvG1IZ_CkTutk8 "Kool & the Gang", Pechanga Resort Casino, dateTime 2026-11-21T04:00:00Z, ticket
// URL ".../kool-the-gang-temecula-california-11-20-2026/...". localDate 2026-11-20 is the URL's date; localTime 20:00:00 is that dateTime
// in Pacific time (the two fields set from the row, as Discovery sends them).
describe('Ticketmaster local date and time (Moreno Valley, 8 PM)', () => {
  const raw = {
    id: 'vvG1IZ_CkTutk8', name: 'Kool & the Gang',
    url: 'https://www.ticketmaster.com/kool-the-gang-temecula-california-11-20-2026/event/0A0064E1BF369190',
    dates: { start: { localDate: '2026-11-20', localTime: '20:00:00', dateTime: '2026-11-21T04:00:00Z' } },
    _embedded: { venues: [{ name: 'Pechanga Resort Casino' }] },
  };
  const item = normalizeTicketmasterEvent(raw as Parameters<typeof normalizeTicketmasterEvent>[0]);
  const mv = rowEnvFor({ timezone: 'America/Los_Angeles', cityName: 'Moreno Valley', country: 'us' }, new Date('2026-11-20T16:52:00Z'));
  it('shows 8 PM on Fri, Nov 20 (UTC is already Nov 21)', () => {
    const r = rowFromTicketmaster(item, mv);
    expect(r.time).toBe('8 PM');
    expect(r.day).toBe('2026-11-20');
    expect(groupByDay([r], mv).map((g) => [g.key, g.label])).toEqual([['2026-11-20', 'Fri, Nov 20']]);
  });
  it('reads no time zone at all: the same row in a UTC-zoned build still says 8 PM on Nov 20', () => {
    const r = rowFromTicketmaster(item, { ...mv, tz: 'UTC' });
    expect([r.time, r.day]).toEqual(['8 PM', '2026-11-20']);
  });
  it('a date-only listing (00:00) claims no time', () => {
    expect(clockFromLocalTime('00:00:00', false)).toBe('');
    expect(clockFromLocalTime('19:30:00', true)).toBe('7:30pm');
  });
  it('This weekend (rail): Friday to Sunday by localDate; on a Friday from today', () => {
    expect(weekendWindow('2026-11-18')).toEqual({ from: '2026-11-20', to: '2026-11-22' });
    expect(weekendWindow('2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-22' });
    expect(weekendWindow('2026-11-22')).toEqual({ from: '2026-11-22', to: '2026-11-22' });
    expect(weekendShows([item], '2026-11-20').map((i) => i.ticketmasterEvent.id)).toEqual(['vvG1IZ_CkTutk8']);
    expect(weekendShows([item], '2026-11-23')).toEqual([]);
  });
});
