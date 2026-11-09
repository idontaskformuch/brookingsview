import { describe, it, expect } from 'vitest';
import {
  badgesFor, timeState, isStartingSoon, walkMinutes, pairNights, regionOf, unmappedAreas, chipPlan, countByRegion, matchesArea, surprisePick, surpriseCandidates,
  nextUp, untilLabel, isBigShow, bigShowsLine, bigShowLabel, partitionBig, bucketOf, bucketLabel, heroFor, dayView, cityLabel, cityScope, scopeLine, type SurpriseCard, type LatePlace,
} from './tonight-cards';
import { groupForTicketmaster, groupLabel, cleanCity, type EveningEntry } from './evening-items';
import { hasEnded } from './local-day';
import { readFileSync } from 'node:fs';
import { cityOfAddress, ownVenueCity, type FeedItem } from './events';
import type { Facility } from './db';
import { ALL_CONFIGS } from './site-config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import TonightChips from '../components/tonight/TonightChips.astro';

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

const REGIONS = ALL_CONFIGS.find((c) => c.townId === 'glasgow')!.eveningLayer!.cards!.regions;
const ORDER = Object.keys(REGIONS);
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/glasgow-neighbourhoods-2026-11-04.json', import.meta.url), 'utf8')).neighbourhoods as string[];

describe('region mapping (Glasgow, owner-approved table)', () => {
  it('maps a neighbourhood to its region', () => {
    expect(regionOf('Merchant City', REGIONS)).toBe('Merchant City');
    expect(regionOf('Yorkhill', REGIONS)).toBe('Finnieston');
    expect(regionOf('Sandyford', REGIONS)).toBe('Finnieston');
    expect(regionOf('Cathedral Precinct', REGIONS)).toBe('Merchant City');
    expect(regionOf("Queen's Cross", REGIONS)).toBe('West End');
  });
  it('unmapped or missing means no region (shown under All only)', () => { expect(regionOf('Nowhere', REGIONS)).toBeNull(); expect(regionOf(null, REGIONS)).toBeNull(); });
  it('a neighbourhood is in one region only', () => {
    const all = Object.values(REGIONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it('the table covers every neighbourhood in the fixture (a miss is listed here and logged at build)', () => expect(unmappedAreas(FIXTURE, REGIONS)).toEqual([]));
  it('unmappedAreas reports new neighbourhoods, sorted and once', () => expect(unmappedAreas(['Hillhead', 'Zed', 'Alpha', 'Zed', null], REGIONS)).toEqual(['Alpha', 'Zed']));
  it('region order is the chip order', () => expect(ORDER).toEqual(['City Centre', 'Finnieston', 'West End', 'Merchant City', 'East End', 'Southside']));
});

describe('chip plan (>= 3 things per chip, >= 2 chips for the row)', () => {
  it('no chip under the threshold', () => expect(chipPlan({ 'City Centre': 5, 'West End': 2, Southside: 3 }, ORDER, null).visible).toEqual(['City Centre', 'Southside']));
  it('fewer than two qualifying chips hides the whole row', () => {
    expect(chipPlan({ 'City Centre': 9, 'West End': 2 }, ORDER, null).showRow).toBe(false);
    expect(chipPlan({}, ORDER, null).showRow).toBe(false);
  });
  it('two qualifying chips show the row', () => expect(chipPlan({ 'City Centre': 3, 'West End': 3 }, ORDER, null).showRow).toBe(true));
  it('the selected chip stays while selected even if it fell under', () => expect(chipPlan({ 'City Centre': 4, Southside: 3, 'West End': 1 }, ORDER, 'West End').visible).toContain('West End'));
  it('counts are events + Open late: the same function counts both', () => expect(countByRegion(['West End', 'West End', null, undefined, 'City Centre'])).toEqual({ 'West End': 2, 'City Centre': 1 }));
  it('chips keep the config order', () => expect(chipPlan({ Southside: 4, 'City Centre': 4 }, ORDER, null).visible).toEqual(['City Centre', 'Southside']));
});

describe('chips never render a number', () => {
  it('names only, and below-threshold chips are hidden', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(TonightChips, { props: { order: ORDER, plan: chipPlan({ 'City Centre': 12, 'West End': 30, Southside: 1 }, ORDER, null) } });
    const labels = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
    expect(labels).toEqual(['All', ...ORDER]);
    for (const l of labels) expect(l).not.toMatch(/\d/);
    expect(html).not.toContain('data-tc-chip-n');
    expect(html).toMatch(/data-tc-chip="Southside"[^>]*hidden/);
    expect(html).not.toMatch(/data-tc-chip="West End"[^>]*hidden/);
  });
  it('the row itself is hidden when fewer than two chips qualify', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(TonightChips, { props: { order: ORDER, plan: chipPlan({ 'City Centre': 12 }, ORDER, null) } });
    expect(html).toMatch(/<nav(?=[^>]*data-tc-chips)(?=[^>]*\shidden)[^>]*>/); // attribute order is not part of the contract
  });
});

describe('area filtering', () => {
  it('All (null) matches everything', () => { expect(matchesArea('West End', null)).toBe(true); expect(matchesArea(null, null)).toBe(true); });
  it('a chip matches only its own region; unmapped cards only show under All', () => { expect(matchesArea('West End', 'West End')).toBe(true); expect(matchesArea('Finnieston', 'West End')).toBe(false); expect(matchesArea(null, 'West End')).toBe(false); });
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

describe('US towns: price hidden, Theater spelling', () => {
  it('hidePrice drops the price badge but keeps Free', () => {
    expect(badgesFor(entry({ priceMin: 12, priceCurrency: 'USD' }), true)).toEqual([]);
    expect(badgesFor(entry({ labels: ['Free'], priceMin: 12, priceCurrency: 'USD' }), true)).toEqual([{ kind: 'free', text: 'Free' }]);
  });
  it('Theater in a US town, Theatre elsewhere', () => {
    expect(bucketLabel('theatre', 'us')).toBe('Theater');
    expect(bucketLabel('theatre', 'gb')).toBe('Theatre');
    expect(groupLabel('Theatre', 'us')).toBe('Theater');
    expect(groupLabel('Live music', 'us')).toBe('Live music');
  });
});

describe('venueCity labels (US towns)', () => {
  const center = { lat: 39.9205, lon: -105.0866 }; // Broomfield
  const denver = { venueCity: 'Denver', lat: 39.7392, lon: -104.9903 }; // about 13 mi
  it('no venueCity: no label, and the event is in neither count', () => {
    expect(cityLabel({ venueCity: null, lat: 39.7392, lon: -104.9903 }, 'Broomfield', center)).toBeNull();
    expect(cityLabel({ lat: 39.7392, lon: -104.9903 }, 'Broomfield', center)).toBeNull();
    expect(cityScope(null, 'Broomfield')).toBe('unknown');
  });
  it('the home town gets no label, whatever the case', () => {
    expect(cityLabel({ venueCity: 'Broomfield', lat: 39.92, lon: -105.08 }, 'Broomfield', center)).toBeNull();
    expect(cityLabel({ venueCity: 'BROOMFIELD', lat: 39.92, lon: -105.08 }, 'Broomfield', center)).toBeNull();
    expect(cityScope('broomfield', 'Broomfield')).toBe('home');
  });
  it('the distance is computed from the coordinates, in whole straight-line miles, with a title saying so', () => {
    const l = cityLabel(denver, 'Broomfield', center)!;
    const miles = Number(/(\d+) mi$/.exec(l.text)![1]);
    expect(l.text).toBe(`Denver · ${miles} mi`);
    expect(miles).toBeGreaterThanOrEqual(12);
    expect(miles).toBeLessThanOrEqual(14);
    expect(l.title).toMatch(/straight line from the center of Broomfield/);
    const farther = cityLabel({ venueCity: 'Boulder', lat: 40.015, lon: -105.2705 }, 'Broomfield', center)!;
    expect(farther.text).not.toBe(l.text);
  });
  it('a different venue position gives a different distance (it is not copied from the source)', () => {
    expect(cityLabel({ venueCity: 'Denver', lat: 39.7392, lon: -104.9903 }, 'Broomfield', center)!.text)
      .not.toBe(cityLabel({ venueCity: 'Denver', lat: 39.62, lon: -104.99 }, 'Broomfield', center)!.text);
  });
  it('a city without coordinates shows the name only, no invented distance', () => {
    expect(cityLabel({ venueCity: 'Denver', lat: null, lon: null }, 'Broomfield', center)).toEqual({ text: 'Denver', title: null });
  });
  it('under half a mile reads <1 mi', () => expect(cityLabel({ venueCity: 'Denver', lat: 39.9206, lon: -105.0867 }, 'Broomfield', center)!.text).toBe('Denver · <1 mi'));
  it('cleanCity strips a glued state code and empty values', () => {
    expect(cleanCity('Denver CO')).toBe('Denver');
    expect(cleanCity(' Boulder ')).toBe('Boulder');
    expect(cleanCity('')).toBeNull();
    expect(cleanCity(null)).toBeNull();
  });
  it('scopeLine: only with events outside town; home count only when above zero', () => {
    expect(scopeLine({ home: 5, near: 0, unknown: 0 }, 'Broomfield')).toBeNull();
    expect(scopeLine({ home: 0, near: 0, unknown: 0 }, 'Broomfield')).toBeNull();
    expect(scopeLine({ home: 12, near: 31, unknown: 0 }, 'Broomfield')).toBe('12 in Broomfield · 31 nearby');
    expect(scopeLine({ home: 0, near: 2, unknown: 0 }, 'Moreno Valley')).toBe('2 nearby');
  });
  it('one event with no known city hides "in <town>" but "nearby" still shows', () => {
    expect(scopeLine({ home: 12, near: 31, unknown: 1 }, 'Broomfield')).toBe('31 nearby');
    expect(scopeLine({ home: 2, near: 0, unknown: 1 }, 'Broomfield')).toBeNull();
  });
  it('the card shows no label for an event with no known city', () => {
    expect(cityLabel({ venueCity: null, lat: 33.9, lon: -117.2 }, 'Moreno Valley', { lat: 33.9425, lon: -117.2297 })).toBeNull();
    expect(cityScope(undefined, 'Moreno Valley')).toBe('unknown');
  });
});

describe('Open late dot is fixed, never animated (owner 2026-11-04)', () => {
  it('the card styles have no pulse animation or keyframes', () => {
    const css = readFileSync(new URL('../components/tonight/TonightStyles.astro', import.meta.url), 'utf8');
    expect(css).not.toMatch(/tc-pulse/);
    expect(css).toMatch(/\.tc-card\.is-now \.tc-time::before \{[^}]*background: var\(--c\)/);
    expect(css).not.toMatch(/\.is-now[^{]*\{[^}]*animation/);
  });
});

describe('city of an own event from the venue registry', () => {
  it('cityOfAddress reads the city a registry address names', () => {
    expect(cityOfAddress('14075 Frederick St, Moreno Valley, CA 92553')).toBe('Moreno Valley');
    expect(cityOfAddress('Brookings, SD 57006')).toBe('Brookings');
    expect(cityOfAddress('515 3rd St, Brookings, SD 57006')).toBe('Brookings');
    expect(cityOfAddress('22nd Ave, Brookings, SD')).toBe('Brookings');
  });
  it('no city named, no city: a street or nothing is refused', () => {
    expect(cityOfAddress('22nd Ave, SD')).toBeNull();
    expect(cityOfAddress('Main Street')).toBeNull();
    expect(cityOfAddress(null)).toBeNull();
    expect(cityOfAddress('')).toBeNull();
  });
  it('ownVenueCity: only registry-resolved story events; unknown venues and other sources have none', () => {
    const facilities = [{ name: 'Brookings Public Library', aliases: [], address: '515 3rd St, Brookings, SD 57006' }] as unknown as Facility[];
    const story = (venue: string | null) => ({ sourceKind: 'story', story: { venue_raw: venue } }) as unknown as FeedItem;
    expect(ownVenueCity(story('Brookings Public Library'), facilities)).toBe('Brookings');
    expect(ownVenueCity(story('Somewhere Else'), facilities)).toBeNull();
    expect(ownVenueCity(story(null), facilities)).toBeNull();
    expect(ownVenueCity({ sourceKind: 'sdsu' } as unknown as FeedItem, facilities)).toBeNull();
  });
});

describe('empty evening (owner 2026-11-05)', () => {
  const world = { events: 0, late: 0, tomorrow: 0, word: 'tonight' };
  it('never says "0 things", whatever the counts', () => {
    for (const events of [0, 1, 2, 9]) for (const late of [0, 1, 4]) for (const tomorrow of [0, 1, 7]) {
      const h = heroFor({ events, late, tomorrow, word: 'tonight' });
      expect(`${h.count ?? ''} ${h.label ?? ''} ${h.text ?? ''}`).not.toMatch(/\b0 things?\b/);
    }
  });
  it('events left: the count, singular for one', () => {
    expect(heroFor({ ...world, events: 5 })).toMatchObject({ kind: 'count', count: 5, label: 'things on tonight' });
    expect(heroFor({ ...world, events: 1 }).label).toBe('thing on tonight');
  });
  it('nothing left but Open late places: says so and counts them, no tomorrow link', () => {
    expect(heroFor({ ...world, late: 3, tomorrow: 8 })).toEqual({ kind: 'empty', text: 'Nothing else scheduled tonight · 3 places open late', tomorrow: null });
    expect(heroFor({ ...world, late: 1 }).text).toBe('Nothing else scheduled tonight · 1 place open late');
  });
  it('nothing at all: "Nothing else on tonight", and tomorrow when there is something there', () => {
    expect(heroFor({ ...world, tomorrow: 4 })).toEqual({ kind: 'empty', text: 'Nothing else on tonight', tomorrow: 'Tomorrow: 4 things' });
    expect(heroFor({ ...world, tomorrow: 1 }).tomorrow).toBe('Tomorrow: 1 thing');
    expect(heroFor(world).tomorrow).toBeNull();
  });
  it('the evening heading and event rows hide when nothing is left; Open late alone keeps its row', () => {
    expect(dayView({ events: 2, late: 0 })).toBe('full');
    expect(dayView({ events: 0, late: 2 })).toBe('late-only');
    expect(dayView({ events: 0, late: 0 })).toBe('hidden');
  });
  it('as the last event passes the same rule flips (what the browser does every minute)', () => {
    const tz = 'America/Chicago';
    const evts = [{ start: '2026-11-05T00:30:00.000Z', end: null }, { start: '2026-11-05T01:30:00.000Z', end: null }]; // 6:30pm and 7:30pm CST
    const lateRows = [{ start: '2026-11-05T05:00:00.000Z', end: '2026-11-05T08:00:00.000Z' }];
    const at = (iso: string) => {
      const t = new Date(iso);
      const events = evts.filter((e) => !hasEnded(e, t, tz)).length;
      const late = lateRows.filter((e) => !hasEnded(e, t, tz)).length;
      return { events, late, view: dayView({ events, late }), hero: heroFor({ events, late, tomorrow: 3, word: 'tonight' }) };
    };
    expect(at('2026-11-05T01:00:00Z').hero.kind).toBe('count');
    expect(at('2026-11-05T01:00:00Z').events).toBe(2);
    const after = at('2026-11-05T05:00:00Z'); // 11pm CST: both events over (start + 3 h), Open late still to come
    expect(after.events).toBe(0);
    expect(after.view).toBe('late-only');
    expect(after.hero.text).toMatch(/1 place open late/);
    const none = at('2026-11-05T08:30:00Z'); // Open late over too
    expect(none.view).toBe('hidden');
    expect(none.hero).toEqual({ kind: 'empty', text: 'Nothing else on tonight', tomorrow: 'Tomorrow: 3 things' });
  });
  it('the browser script and the page both use the shared rules (no second copy of the wording)', () => {
    const client = readFileSync(new URL('./tonight-cards-client.ts', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../pages/tonight.astro', import.meta.url), 'utf8');
    expect(client).toMatch(/heroFor\(/); expect(client).toMatch(/dayView\(/);
    expect(page).toMatch(/heroFor\(/); expect(page).toMatch(/dayView\(/);
    expect(client).not.toMatch(/things on \$\{word\}/);
  });
});

describe('library categories (Fas 1d)', () => {
  it('every bucket maps into Tonight\'s category set or to neutral', async () => {
    const { BUCKET_CATEGORY } = await import('./tonight-cards');
    const { CATEGORY_SETS } = await import('./ui/ui-helpers');
    for (const [bucket, cat] of Object.entries(BUCKET_CATEGORY)) {
      if (cat !== null) expect(CATEGORY_SETS.tonight as readonly string[], bucket).toContain(cat);
    }
    expect(new Set(Object.values(BUCKET_CATEGORY).filter(Boolean)).size).toBe(4);
  });
  it('chips use the library thresholds', async () => {
    const { CHIP_MIN_THINGS, CHIP_MIN_CHIPS } = await import('./tonight-cards');
    const ui = await import('./ui/ui-helpers');
    expect([CHIP_MIN_THINGS, CHIP_MIN_CHIPS]).toEqual([ui.CHIP_MIN_ITEMS, ui.CHIP_MIN_CHIPS]);
  });
});

// Owner 2026-11-06: where bigShows is on, Ticketmaster rows on /tonight are kept but never counted in "N things on tonight".
describe('big shows on /tonight', () => {
  const BROOMFIELD = { lat: 39.9205, lon: -105.0866 };
  const tmRow = entry({ id: 'tm:1', source: 'ticketmaster', venueCity: 'Denver', lat: 39.7487, lon: -105.0077 });
  const ownRow = entry({ id: 'own:1', source: 'own' });
  it('a Ticketmaster row is a big show only where bigShows is on', () => {
    expect(isBigShow(tmRow, true)).toBe(true);
    expect(isBigShow(tmRow, false)).toBe(false);
    expect(isBigShow(tmRow, undefined)).toBe(false);
    expect(isBigShow(ownRow, true)).toBe(false);
  });
  it('the header counts the local rows only; the big shows get their own line', () => {
    const rows = [ownRow, ownRow, tmRow, tmRow, tmRow];
    const { local, big } = partitionBig(rows, (r) => isBigShow(r, true));
    expect(heroFor({ events: local.length, late: 0, tomorrow: 0, word: 'tonight' }).count).toBe(2);
    expect(bigShowsLine(big.length)).toBe('+ 3 big shows nearby');
  });
  it('with only big shows tonight the hero is the empty line, never "3 things", and the big line still shows', () => {
    const { local, big } = partitionBig([tmRow, tmRow, tmRow], (r) => isBigShow(r, true));
    const hero = heroFor({ events: local.length, late: 0, tomorrow: 0, word: 'tonight' });
    expect(hero.kind).toBe('empty');
    expect(bigShowsLine(big.length)).toBe('+ 3 big shows nearby');
  });
  it('the line is singular for one and absent for none', () => {
    expect(bigShowsLine(1)).toBe('+ 1 big show nearby');
    expect(bigShowsLine(0)).toBeNull();
  });
  it('every big show reads "City · N mi", the home city included', () => {
    expect(bigShowLabel(tmRow, 'Broomfield', BROOMFIELD)?.text).toMatch(/^Denver · \d+ mi$/);
    expect(bigShowLabel(entry({ venueCity: 'Broomfield', lat: 39.9205, lon: -105.0866 }), 'Broomfield', BROOMFIELD)?.text).toBe('Broomfield · <1 mi');
  });
  it('without coordinates the stated distance is used; without a city only the miles; without either nothing', () => {
    expect(bigShowLabel(entry({ venueCity: 'Denver', lat: null, lon: null, distanceMiles: 14.6 }), 'Broomfield', BROOMFIELD)?.text).toBe('Denver · 15 mi');
    expect(bigShowLabel(entry({ venueCity: null, lat: null, lon: null, distanceMiles: 9 }), 'Broomfield', BROOMFIELD)?.text).toBe('9 mi');
    expect(bigShowLabel(entry({ venueCity: null, lat: null, lon: null, distanceMiles: null }), 'Broomfield', BROOMFIELD)).toBeNull();
  });
  it('the page and the browser both split through partitionBig, and the card carries the label and data-big', () => {
    const page = readFileSync(new URL('../pages/tonight.astro', import.meta.url), 'utf8');
    const client = readFileSync(new URL('./tonight-cards-client.ts', import.meta.url), 'utf8');
    const rows = readFileSync(new URL('../components/tonight/TonightRows.astro', import.meta.url), 'utf8');
    expect(page).toMatch(/partitionBig\(/); expect(client).toMatch(/partitionBig\(/);
    expect(rows).toMatch(/data-big/); // the event rows carry it (the date-tile list); TonightCard is the Open tonight place card only
    expect(client).not.toMatch(/events: liveAll\.length/);
  });
  it('Broomfield has bigShows on and Glasgow does not', () => {
    expect(ALL_CONFIGS.find((c) => c.townId === 'broomfield_co')!.bigShows).toEqual({ enabled: true, maxMiles: 25 });
    expect(ALL_CONFIGS.find((c) => c.townId === 'glasgow')!.bigShows).toBeUndefined();
  });
});
