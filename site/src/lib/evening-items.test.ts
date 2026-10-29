import { describe, expect, it } from 'vitest';
import { ageLabel, driveLabel, driveMinutes, buildEveningEntries, groupForTicketmaster, groupForTitle, toThresholdItems } from './evening-items';
import { evaluateEveningThreshold } from './evening-threshold';
import type { FeedItem } from './events';
import type { Story } from './db';
import type { TicketmasterFeedItem } from './ticketmaster';

const TZ = 'Europe/London';
const NOW = new Date('2026-10-28T14:00:00Z');
const OPTS = { now: NOW, timezone: TZ, checked: '2026-10-28', cityName: 'Glasgow' };

function own(title: string, occurs_at: string | null, extra: Partial<Story> = {}): FeedItem {
  const story = { id: 1, title, slug: title.toLowerCase().replace(/\W+/g, '-'), body: '', source_type: 'event', source_url: null, occurs_at,
    published_at: '2026-10-01T00:00:00Z', generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null, ingredients: null, instructions: null,
    venue_raw: 'The Pub', ...extra } as Story;
  return { sourceKind: 'story', occurs_at, story };
}

function tm(id: string, title: string, occurs_at: string | null, miles: number | null, segment = 'Music', genre = 'Rock'): TicketmasterFeedItem {
  return { sourceKind: 'ticketmaster', occurs_at, ticketmasterEvent: { id, title, attractionId: null, venueId: 'v1', venueName: 'The Hydro', venueLatitude: null,
    venueLongitude: null, venueAddress: null, venueCity: null, venueStateCode: null, venuePostalCode: null, venueDistanceMiles: miles, ticketUrl: 'https://tm/x',
    imageUrl: null, imageWidth: null, imageHeight: null, priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null, segment, genre } };
}

describe('groupForTitle', () => {
  it('maps keywords to groups, quiz before comedy', () => {
    expect(groupForTitle('Tuesday Pub Quiz')).toBe('Quiz & pub nights');
    expect(groupForTitle('Comedy Quiz Night')).toBe('Quiz & pub nights');
    expect(groupForTitle('Stand-up Showcase')).toBe('Comedy & shows');
    expect(groupForTitle('Open Mic Night')).toBe('Live music');
    expect(groupForTitle('Saturday Club Night')).toBe('Clubs & late');
    expect(groupForTitle('Rovers vs Celtic')).toBe('Sport tonight');
    expect(groupForTitle('Knitting group')).toBeNull();
  });
});

describe('groupForTicketmaster', () => {
  it('uses the source classification', () => {
    expect(groupForTicketmaster('Music', 'Rock')).toBe('Live music');
    expect(groupForTicketmaster('Music', 'Dance/Electronic')).toBe('Clubs & late');
    expect(groupForTicketmaster('Arts & Theatre', 'Comedy')).toBe('Comedy & shows');
    expect(groupForTicketmaster('Miscellaneous', null)).toBeNull();
    expect(groupForTicketmaster(null, null)).toBeNull();
  });
});

describe('ageLabel', () => {
  it('reads only the audience field', () => {
    expect(ageLabel('18+')).toBe('18+');
    expect(ageLabel('Over 18s only')).toBe('18+');
    expect(ageLabel('All ages welcome')).toBe('All ages');
    expect(ageLabel('Ages 8-12')).toBeNull();
    expect(ageLabel(null)).toBeNull();
  });
});

describe('buildEveningEntries', () => {
  it('drops ended items, undated items and away-shows; adds labels, links and checked date', () => {
    const entries = buildEveningEntries({
      ...OPTS,
      feed: [
        own('Pub Quiz', '2026-10-28T19:30:00Z', { meta: { audience: '18+' } }),
        own('Old Gig', '2026-10-28T10:00:00Z'),
        own('No time', null),
        own('Open Mic', '2026-10-29T19:00:00Z'),
      ],
      ticketmaster: [tm('a', 'Big Band', '2026-10-30T19:00:00Z', 1), tm('b', 'Away Show', '2026-10-30T19:00:00Z', 40), tm('c', 'No distance', '2026-10-30T19:00:00Z', null)],
      isFree: (i) => i.sourceKind === 'story' && i.story.title === 'Open Mic',
    });
    expect(entries.map((e) => e.title)).toEqual(['Pub Quiz', 'Open Mic', 'Big Band']);
    expect(entries[0]).toMatchObject({ group: 'Quiz & pub nights', labels: ['18+'], href: '/s/pub-quiz/', source: 'own', checked: '2026-10-28' });
    expect(entries[1].labels).toEqual(['Free']);
    expect(entries[2]).toMatchObject({ group: 'Live music', source: 'ticketmaster', href: expect.stringMatching(/^\/whats-on\//) });
  });

  it('counts the same title, venue and start once; a wider radius admits regional shows', () => {
    const dup = own('Pub Quiz', '2026-10-28T19:30:00Z');
    const entries = buildEveningEntries({ ...OPTS, feed: [dup, dup], ticketmaster: [tm('b', 'Away Show', '2026-10-30T19:00:00Z', 40)], ticketmasterMaxMiles: 50 });
    expect(entries.map((e) => e.title)).toEqual(['Pub Quiz', 'Away Show']);
  });

  it('keeps an event that has started but not ended', () => {
    const entries = buildEveningEntries({ ...OPTS, feed: [own('Late Gig', '2026-10-28T13:00:00Z', { ends_at: '2026-10-28T16:00:00Z' })] });
    expect(entries).toHaveLength(1);
  });
});

describe('toThresholdItems', () => {
  it('feeds the threshold engine; Free never makes a group', () => {
    const feed = Array.from({ length: 14 }, (_, d) => Array.from({ length: 10 }, (_, i) =>
      own(`Library talk ${d}-${i}`, new Date(Date.UTC(2026, 9, 29 + d, 19, i)).toISOString()))).flat();
    const entries = buildEveningEntries({ ...OPTS, feed, isFree: () => true });
    const v = evaluateEveningThreshold({ items: toThresholdItems(entries), now: NOW, timezone: TZ });
    expect(v.medianItems).toBe(10);
    expect(v.medianGroups).toBe(0);
    expect(v.indexable).toBe(false);
    expect(v.reason).toBe('below-groups');
  });
});

describe('Ticketmaster sport', () => {
  const sport = tm('s', 'Rovers v United', '2026-10-30T19:45:00Z', 2, 'Sports', 'Football');
  it('counts as Sport tonight where the town has no sport source of its own', () => {
    const [e] = buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [sport], includeTicketmasterSports: true });
    expect(e).toMatchObject({ title: 'Rovers v United', group: 'Sport tonight' });
  });
  it('is left out where it would duplicate the town own sport feed (Brookings)', () => {
    expect(buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [sport] })).toEqual([]);
    expect(buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [sport], includeTicketmasterSports: false })).toEqual([]);
  });
});

describe('drive time outside the town', () => {
  it('is an estimate with "about", rounded to 5 minutes', () => {
    expect(driveMinutes(35) % 5).toBe(0);
    expect(driveMinutes(35)).toBeGreaterThan(driveMinutes(12));
    expect(driveLabel(driveMinutes(35))).toMatch(/^about \d+ min drive$/);
    expect(driveLabel(null)).toBeNull();
  });
  it('is set on rows beyond the town and null inside it', () => {
    const entries = buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [tm('a', 'In Town', '2026-10-30T19:00:00Z', 1), tm('b', 'Out Of Town', '2026-10-30T20:00:00Z', 12)], ticketmasterMaxMiles: 15 });
    expect(entries.find((e) => e.title === 'In Town')!.driveMinutes).toBeNull();
    const out = entries.find((e) => e.title === 'Out Of Town')!;
    expect(out.distanceMiles).toBe(12);
    expect(out.driveMinutes).toBe(driveMinutes(12));
  });
  it('honours maxMiles per town (Glasgow 15 drops a 20-mile show, Broomfield 20 keeps it)', () => {
    const far = tm('c', 'Twenty Miles', '2026-10-30T19:00:00Z', 20);
    expect(buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [far], ticketmasterMaxMiles: 15 })).toEqual([]);
    expect(buildEveningEntries({ ...OPTS, feed: [], ticketmaster: [far], ticketmasterMaxMiles: 20 })).toHaveLength(1);
  });
});

describe('the same show from two sources', () => {
  it('is one row: same start, one title contains the other; the shorter title wins and labels merge', () => {
    const entries = buildEveningEntries({
      ...OPTS,
      feed: [own('DF Concerts Presents: NOAHFINNCE', '2026-10-29T19:00:00Z', { meta: { audience: '18+' } })],
      ticketmaster: [tm('n', 'NOAHFINNCE', '2026-10-29T19:00:00Z', 1)],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: 'NOAHFINNCE', source: 'ticketmaster', labels: ['18+'] });
  });
  it('keeps different shows at the same time apart', () => {
    const entries = buildEveningEntries({ ...OPTS, feed: [own('Pub Quiz', '2026-10-29T19:00:00Z')], ticketmaster: [tm('n', 'Big Band', '2026-10-29T19:00:00Z', 1)] });
    expect(entries).toHaveLength(2);
  });
});
