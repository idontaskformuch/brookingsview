/** Day blocks for /events/ and /this-week/ (owner 2026-11-26 (7), rollout a). Rows: Glasgow /events/ as built 2026-11-26 (battery
 *  build, dist/events/index.html), Thu 26 and Sat 28 Nov, ordagrant: title, time, href, category, place and extras. */
import { describe, expect, it } from 'vitest';
import { eventDigest, featuredIndex, isRecurring, isRun, MAX_COMPACT, splitDay } from './day-digest';
import type { EventRowData } from './event-row';

const row = (o: Partial<EventRowData> & Pick<EventRowData, 'title' | 'start'>): EventRowData => ({
  end: null, time: '', href: null, rel: null, place: [], extra: [], category: null, ...o,
});
const GL = 'https://www.glasgowlife.org.uk/event';
const THU = [
  row({ title: 'Hopscotch Theatre and Glasgow Life present Hansel & Gretel', start: '2026-11-26T00:00:00.000Z', end: '2026-12-20T00:00:00.000Z', href: `${GL}/1/hopscotch-theatre-and-glasgow-life-present-hansel-gretel`, category: 'arts', place: ['Various Glasgow Venues'] }),
  row({ title: 'Soft Play Music Mornings', start: '2026-11-26T09:30:00.000Z', time: '9:30am', href: `${GL}/1/soft-play-music-mornings`, category: 'music', place: ['Kelvin Hall'], extra: ['Regular'] }),
  row({ title: 'Honey Bees Knitting group', start: '2026-11-26T13:30:00.000Z', time: '1:30pm', href: `${GL}/1/honey-bees-knitting-group`, extra: ['Regular'] }),
  row({ title: 'Sight Loss Group at Library @ the Bridge', start: '2026-11-26T14:00:00.000Z', time: '2pm', href: `${GL}/1/sight-loss-group-at-library-the-bridge`, extra: ['Regular'] }),
  row({ title: 'Bedtime Bookbug', start: '2026-11-26T17:30:00.000Z', time: '5:30pm', href: '/s/event-series-e8534a063ee2867b/', place: ['Library at The Bridge'], extra: ['Weekly', 'Free', 'Kids and families'] }),
];
const SAT = [
  row({ title: 'Discover! Weekend Sessions', start: '2026-11-28T00:00:00.000Z', href: `${GL}/8/discover-weekend-sessions`, place: ['The Burrell Collection'], extra: ['Regular'] }),
  row({ title: 'Glasgow Vintage Vehicle Trust', start: '2026-11-28T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', href: `${GL}/2/glasgow-vintage-vehicle-trust`, place: ['Riverside Museum'], extra: ['Free · All ages'] }),
  row({ title: 'Festive Peformances at The Burrell', start: '2026-11-28T00:00:00.000Z', end: '2026-12-21T00:00:00.000Z', href: '/s/event-333846/', category: 'arts', place: ['The Burrell Collection'], extra: ['Free · All ages'] }),
  row({ title: 'Riverside Christmas Market', start: '2026-11-28T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', href: '/s/event-333844/', category: 'food', place: ['Riverside Museum'], extra: ['Free · All ages'] }),
  row({ title: 'Saturday Art Club', start: '2026-11-28T10:30:00.000Z', time: '10:30am', href: `${GL}/28/saturday-art-club`, category: 'arts', extra: ['Regular'] }),
  row({ title: 'Album Cover Design - Family Workshop with Harold Offeh', start: '2026-11-28T11:15:00.000Z', time: '11:15am', href: '/s/event-333575/', category: 'family', place: ['Tramway'], extra: ['Kids and families'] }),
  row({ title: 'Fat Dog', start: '2026-11-28T19:00:00.000Z', time: '7pm', href: '/s/event-333847/', place: ['Old Fruitmarket'] }),
  row({ title: 'Hanna Tuulikki - Deer Dancer', start: '2026-11-28T19:30:00.000Z', time: '7:30pm', href: `${GL}/2/hanna-tuulikki-deer-dancer`, place: ['Tramway'] }),
];

describe('digest line', () => {
  it('Sat 28 Nov: the count, the two commonest categories, how many are free', () => {
    expect(eventDigest(SAT)).toBe('8 events · 2 arts · 1 family · 3 free');
  });
  it('Thu 26 Nov: categories tie at one each, alphabetical; Bookbug says "Free"', () => {
    expect(eventDigest(THU)).toBe('5 events · 1 arts · 1 music · 1 free');
  });
  it('one category only: no category words; one row or none: no digest (the row says it all)', () => {
    expect(eventDigest([SAT[4], SAT[2]])).toBe('2 events · 1 free');
    expect(eventDigest([THU[2]])).toBe('');
    expect(eventDigest([])).toBe('');
  });
});

describe('the featured event', () => {
  it('Sat 28 Nov: the first one-off with a link (the family workshop), not a weekly club or a run of days', () => {
    expect(SAT[featuredIndex(SAT)].title).toBe('Album Cover Design - Family Workshop with Harold Offeh');
    expect(isRecurring(SAT[0])).toBe(true);
    expect(isRun(SAT[1])).toBe(true);
  });
  it('Thu 26 Nov: no one-off, so the run (Hansel & Gretel to 20 Dec); never a "Regular" or "Weekly" row', () => {
    expect(THU[featuredIndex(THU)].title).toBe('Hopscotch Theatre and Glasgow Life present Hansel & Gretel');
    expect(featuredIndex(THU.slice(1))).toBe(-1);
  });
  it('a top event of the town goes first (Fat Dog marked top here); one row is no card', () => {
    expect(SAT[featuredIndex(SAT, (r) => r.title === 'Fat Dog')].title).toBe('Fat Dog');
    expect(featuredIndex([SAT[6]])).toBe(-1);
  });
});

describe('/this-week/ rows (no extras, the source flag instead)', () => {
  // Discover! Weekend Sessions as the week page builds it: no "Regular" extra, `recurring` from the source (it is "Regular" on /events/).
  const discover = { ...SAT[0], extra: [], recurring: true };
  it('a row flagged recurring is never featured, though no extra says so (Sat 28 Nov on the week page, 2026-11-26)', () => {
    expect(isRecurring(discover)).toBe(true);
    const day = [discover, SAT[5]];
    expect(day[featuredIndex(day)].title).toBe('Album Cover Design - Family Workshop with Harold Offeh');
  });
  it('a civic count reads "1 civic event", not "1 civic" (Thu 26 Nov on the week page: the committee and Hansel & Gretel)', () => {
    const committee = row({ title: 'Contracts and Property Committee — Thu 26 Nov 2026', start: '2026-11-26T00:00:00.000Z', href: '/s/meeting-2026-11-26-15127/', category: 'civic' });
    expect(eventDigest([committee, THU[0]])).toBe('2 events · 1 arts · 1 civic event');
  });
});

describe('fold', () => {
  it(`Sat 28 Nov: featured, then ${MAX_COMPACT} compact rows, the other 2 behind "2 more"`, () => {
    const { featured, shown, more } = splitDay(SAT);
    expect(featured?.title).toBe('Album Cover Design - Family Workshop with Harold Offeh');
    expect(shown).toHaveLength(MAX_COMPACT);
    expect(more.map((r) => r.title)).toEqual(['Fat Dog', 'Hanna Tuulikki - Deer Dancer']);
    expect([featured, ...shown, ...more]).toHaveLength(SAT.length);
  });
});
