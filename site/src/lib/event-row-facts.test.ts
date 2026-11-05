import { describe, expect, it } from 'vitest';
import { makeRowFacts } from './event-row-facts';
import type { FeedItem } from './events';
import type { Story, Facility } from './db';

const story = (o: Partial<Story> & { meta?: Record<string, unknown> }): FeedItem => ({
  sourceKind: 'story', occurs_at: '2026-11-11T19:00:00Z',
  story: { id: 1, title: 'T', slug: 't', body: '', source_type: 'event', source_url: null, occurs_at: '2026-11-11T19:00:00Z', published_at: '', generated_by: 's',
    byline: null, image_path: null, image_alt: null, rating: null, ingredients: null, instructions: null, ...o } as Story,
});
const facility = { slug: 'tramway', name: 'Tramway', category: 'theatre', name_aliases: ['tramway'], aliases: ['tramway'], lat: 55.8305, lon: -4.2655 } as unknown as Facility;
const ctx = { cityName: 'Glasgow', facilities: [facility], areas: { attribution: '', venues: {}, areas: [{ name: 'Pollokshields', lat: 55.834, lon: -4.266 }] } };

describe('row facts', () => {
  it('structured cost beats the venue rule, both ways', () => {
    const f = makeRowFacts(ctx);
    expect(f(story({ meta: { cost: 'Free, ticket required' } })).free).toBe(true);
    expect(f(story({ meta: { cost: '£18 / £12 concession' } })).free).toBe(false);
  });
  it('no cost and no known free venue is not free', () => {
    expect(makeRowFacts(ctx)(story({ venue_raw: 'Tramway' })).free).toBe(false);
  });
  it('area comes from the venue coordinates, venue from the source', () => {
    const r = makeRowFacts(ctx)(story({ venue_raw: 'Tramway', meta: { venue: 'Tramway, 25 Albert Drive' } }));
    expect(r.venue).toBe('Tramway, 25 Albert Drive');
    expect(r.area).toBe('Pollokshields');
  });
  it('no coordinates and no area file entry gives no area, never a guess', () => {
    expect(makeRowFacts({ ...ctx, areas: null })(story({ venue_raw: 'Tramway' })).area).toBeNull();
  });
  it('kids by title keyword where the town has no source tag', () => {
    const f = makeRowFacts(ctx);
    expect(f(story({ title: 'Toddler Storytime' })).kids).toBe(true);
    expect(f(story({ title: 'Jazz night' })).kids).toBe(false);
  });
});
