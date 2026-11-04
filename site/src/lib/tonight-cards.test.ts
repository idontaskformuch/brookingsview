import { describe, it, expect } from 'vitest';
import {
  badgesFor, timeState, isStartingSoon, walkMinutes, pairNights, chipsFor, matchesArea, surprisePick, surpriseCandidates,
  nextUp, untilLabel, bucketOf, type SurpriseCard, type LatePlace,
} from './tonight-cards';
import { groupForTicketmaster, type EveningEntry } from './evening-items';
import { hasEnded } from './local-day';

const TZ = 'Europe/London';
const now = new Date('2026-11-04T19:00:00Z'); // GMT: 19:00 local
const at = (hhmm: string) => `2026-11-04T${hhmm}:00.000Z`;

const entry = (over: Partial<EveningEntry> = {}): EveningEntry => ({
  id: 'e1', title: 'Show', start: at('20:00'), end: null, group: 'Live music', labels: [], venue: 'Venue', href: '/x/', source: 'ticketmaster',
  distanceMiles: null, driveMinutes: null, checked: '2026-11-04', ...over,
});

describe('badgesFor: no badge without data', () => {
  it('nothing stated, nothing shown', () => expect(badgesFor(entry())).toEqual([]));
  it('null price and null currency give no badge', () => expect(badgesFor(entry({ priceMin: null, priceCurrency: null }))).toEqual([]));
  it('Free only from the source label', () => expect(badgesFor(entry({ labels: ['Free'] }))).toEqual([{ kind: 'free', text: 'Free' }]));
  it('18+ / All ages labels are not badges', () => expect(badgesFor(entry({ labels: ['18+', 'All ages'] }))).toEqual([]));
  it('a stated GBP price shows as the lowest price', () => expect(badgesFor(entry({ priceMin: 12, priceCurrency: 'GBP' }))).toEqual([{ kind: 'price', text: '£12' }]));
  it('pence are kept', () => expect(badgesFor(entry({ priceMin: 12.5, priceCurrency: 'GBP' }))[0].text).toBe('£12.50'));
  it('a price without a currency is not written', () => expect(badgesFor(entry({ priceMin: 12, priceCurrency: null }))).toEqual([]));
  it('an unknown currency is not written', () => expect(badgesFor(entry({ priceMin: 12, priceCurrency: 'XYZ' }))).toEqual([]));
  it('a zero price is not a price', () => expect(badgesFor(entry({ priceMin: 0, priceCurrency: 'GBP' }))).toEqual([]));
});

describe('timeState', () => {
  it('more than an hour away is the clock time', () => expect(timeState(at('20:30'), null, now, TZ)).toEqual({ kind: 'clock', text: '8:30pm' }));
  it('within the hour counts minutes, rounded up', () => expect(timeState(at('19:26'), null, now, TZ)).toEqual({ kind: 'soon', text: 'in 26 min' }));
  it('exactly an hour is still "in 60 min"', () => expect(timeState(at('20:00'), null, now, TZ).text).toBe('in 60 min'));
  it('started and not over is On now', () => expect(timeState(at('18:30'), null, now, TZ)).toEqual({ kind: 'now', text: 'On now' }));
  it('an end time ends it', () => expect(hasEnded({ start: at('18:00'), end: at('18:45') }, now, TZ)).toBe(true));
  it('past the 3 h default it is no longer On now', () => expect(timeState(at('15:30'), null, now, TZ).kind).toBe('clock'));
});

describe('passed events are hidden (start + 3 h, or the end time)', () => {
  it('no end: over 3 h after the start', () => {
    expect(hasEnded({ start: at('15:59'), end: null }, now, TZ)).toBe(true);
    expect(hasEnded({ start: at('16:01'), end: null }, now, TZ)).toBe(false);
  });
  it('an end time wins over the 3 h default', () => {
    expect(hasEnded({ start: at('17:00'), end: at('18:00') }, now, TZ)).toBe(true);
    expect(hasEnded({ start: at('17:00'), end: at('21:00') }, now, TZ)).toBe(false);
  });
});

describe('isStartingSoon (90 min or on now)', () => {
  it('89 min away', () => expect(isStartingSoon(at('20:29'), null, now, TZ)).toBe(true));
  it('91 min away', () => expect(isStartingSoon(at('20:31'), null, now, TZ)).toBe(false));
  it('on now', () => expect(isStartingSoon(at('18:00'), null, now, TZ)).toBe(true));
  it('over', () => expect(isStartingSoon(at('14:00'), null, now, TZ)).toBe(false));
});

describe('walkMinutes', () => {
  const a = { lat: 55.8642, lon: -4.2518 };
  it('same spot is 0', () => expect(walkMinutes(a, a)).toBe(0));
  it('~1 km straight line = 1000 x 1.3 / 80 = 16 min', () => {
    const b = { lat: a.lat + 1000 / 111_195, lon: a.lon }; // 1000 m north
    expect(walkMinutes(a, b)).toBe(16);
  });
  it('~460 m straight line is about 7 min', () => expect(walkMinutes(a, { lat: a.lat + 460 / 111_195, lon: a.lon })).toBe(7));
});

describe('pairNights (Make a night of it)', () => {
  const near = { lat: 55.8642, lon: -4.2518 };
  const place = (over: Partial<LatePlace> = {}): LatePlace => ({ osmId: 'node/1', name: 'Mango', closing: 'until 3am', end: '2026-11-05T03:00:00.000Z', lat: near.lat + 0.004, lon: near.lon, ...over });
  const ev = (over: Partial<EveningEntry> = {}) => entry({ lat: near.lat, lon: near.lon, ...over });
  it('pairs an event with a close late place that is open after the show', () => {
    const [p] = pairNights([ev()], [place()], now, TZ);
    expect(p.place.name).toBe('Mango');
    expect(p.walk).toBeGreaterThan(0);
    expect(p.walk).toBeLessThanOrEqual(10);
  });
  it('the events own venue is not its pair', () => expect(pairNights([ev({ venue: 'The Rum Shack' })], [place({ name: 'The Rum Shack' })], now, TZ)).toEqual([]));
  it('a place under two minutes away is the same spot, not a walk', () => expect(pairNights([ev()], [place({ lat: near.lat + 0.0005 })], now, TZ)).toEqual([]));
  it('no coordinates on the place, no pair (snapshot without centres)', () => expect(pairNights([ev()], [place({ lat: null, lon: null })], now, TZ)).toEqual([]));
  it('no coordinates on the event, no pair', () => expect(pairNights([ev({ lat: null, lon: null })], [place()], now, TZ)).toEqual([]));
  it('further than 10 min walk is left out', () => expect(pairNights([ev()], [place({ lat: near.lat + 0.02 })], now, TZ)).toEqual([]));
  it('a place that closes before the show is likely over is left out', () => expect(pairNights([ev()], [place({ end: at('21:30') })], now, TZ)).toEqual([]));
  it('an event that has passed is left out', () => expect(pairNights([ev({ start: at('14:00') })], [place()], now, TZ)).toEqual([]));
  it('one pair per event and per place, at most three', () => {
    const events = [1, 2, 3, 4].map((i) => ev({ id: `e${i}`, start: at(`2${i - 1}:00`) }));
    const places = [1, 2, 3, 4].map((i) => place({ osmId: `node/${i}`, name: `P${i}` }));
    const pairs = pairNights(events, places, now, TZ);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.map((p) => p.event.id)).size).toBe(3);
    expect(new Set(pairs.map((p) => p.place.osmId)).size).toBe(3);
  });
});

describe('area chips and filtering', () => {
  it('counts per area, biggest first, rows without area only in All', () => {
    expect(chipsFor(['West End', 'Merchant City', 'West End', null, undefined, 'Finnieston', 'West End', 'Merchant City']))
      .toEqual([{ area: 'West End', count: 3 }, { area: 'Merchant City', count: 2 }, { area: 'Finnieston', count: 1 }]);
  });
  it('limits the number of chips', () => expect(chipsFor(['a', 'b', 'c'], 2)).toHaveLength(2));
  it('All (null) matches everything', () => { expect(matchesArea('West End', null)).toBe(true); expect(matchesArea(null, null)).toBe(true); });
  it('a chip matches only its own area', () => { expect(matchesArea('West End', 'West End')).toBe(true); expect(matchesArea('Finnieston', 'West End')).toBe(false); expect(matchesArea(null, 'West End')).toBe(false); });
});

describe('Surprise me', () => {
  const c = (id: string, start: string, over: Partial<SurpriseCard> = {}): SurpriseCard => ({ id, start, end: null, area: 'West End', bucket: 'music', ...over });
  it('picks only events starting within 3 h or on now', () => {
    const cards = [c('soon', at('21:30')), c('late', at('23:30')), c('on', at('18:00'))];
    expect(surpriseCandidates(cards, now, TZ, null).map((x) => x.id).sort()).toEqual(['on', 'soon']);
  });
  it('respects the selected area', () => {
    const cards = [c('a', at('20:00'), { area: 'Finnieston' }), c('b', at('20:00'))];
    expect(surprisePick(cards, now, TZ, 'West End', () => 0)?.id).toBe('b');
  });
  it('never picks a passed event or an Open late place', () => {
    const cards = [c('old', at('12:00')), c('bar', at('20:00'), { bucket: 'late' })];
    expect(surprisePick(cards, now, TZ, null)).toBeNull();
  });
  it('no match, no pick (the button is then not shown)', () => expect(surprisePick([], now, TZ, null)).toBeNull());
  it('the random number picks within the pool', () => {
    const cards = [c('a', at('20:00')), c('b', at('20:10')), c('d', at('20:20'))];
    expect(surprisePick(cards, now, TZ, null, () => 0.99)?.id).toBe('d');
    expect(surprisePick(cards, now, TZ, null, () => 0)?.id).toBe('a');
  });
});

describe('header helpers', () => {
  it('nextUp ignores events already started', () => expect(nextUp([{ start: at('18:00') }, { start: at('20:30') }, { start: at('20:00') }], now)?.start).toBe(at('20:00')));
  it('nextUp is null when nothing is ahead', () => expect(nextUp([{ start: at('18:00') }], now)).toBeNull());
  it('untilLabel', () => { expect(untilLabel(at('19:12'), now)).toBe('in 12 min'); expect(untilLabel(at('20:05'), now)).toBe('in 1 h 5 min'); });
});

describe('Theatre group (Ticketmaster genre Theatre only)', () => {
  it('genre Theatre in Arts & Theatre is Theatre', () => expect(groupForTicketmaster('Arts & Theatre', 'Theatre')).toBe('Theatre'));
  it('comedy and dance stay in Comedy & shows', () => {
    expect(groupForTicketmaster('Arts & Theatre', 'Comedy')).toBe('Comedy & shows');
    expect(groupForTicketmaster('Arts & Theatre', 'Dance')).toBe('Comedy & shows');
  });
  it('Theatre has its own colour bucket, other groups fall to Also on', () => {
    expect(bucketOf('Theatre')).toBe('theatre');
    expect(bucketOf('Sport')).toBe('other');
    expect(bucketOf(null)).toBe('other');
  });
});
