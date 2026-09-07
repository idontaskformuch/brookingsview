import { describe, it, expect } from 'vitest';
import { rankTicketmasterEvents, splitMarquee, MARQUEE_SIZE, ticketmasterSlug, ticketmasterResolvableImage } from './whats-on';
import type { TicketmasterFeedItem, TicketmasterEvent } from './ticketmaster';

function tmEvent(overrides: Partial<TicketmasterEvent> = {}): TicketmasterEvent {
  return {
    id: 'tm-1', title: 'Untitled Event', venueId: null, venueName: null,
    venueLatitude: null, venueLongitude: null, venueAddress: null,
    venueCity: null, venueStateCode: null, venuePostalCode: null,
    venueDistanceMiles: null, ticketUrl: 'https://ticketmaster.com/event/x',
    imageUrl: null, imageWidth: null, imageHeight: null,
    priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
    ...overrides,
  };
}

function tmItem(occurs_at: string | null, overrides: Partial<TicketmasterEvent> = {}): TicketmasterFeedItem {
  return { sourceKind: 'ticketmaster', occurs_at, ticketmasterEvent: tmEvent(overrides) };
}

describe('rankTicketmasterEvents', () => {
  it('returns [] for an empty list', () => {
    expect(rankTicketmasterEvents([], 'brookings_sd')).toEqual([]);
  });

  it('handles a single-item list without erroring', () => {
    const item = tmItem('2026-10-24T19:00:00Z', { id: 'a', title: 'Solo Event' });
    const ranked = rankTicketmasterEvents([item], 'brookings_sd');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].item).toBe(item);
  });

  it('respects venue tier ordering -- a curated medium venue outranks an uncurated (default small) one, regardless of date', () => {
    const small = tmItem('2026-10-10T18:00:00Z', { id: 'small', title: 'Small Venue Event', venueName: 'Some Uncurated Venue' });
    const medium = tmItem('2026-10-24T19:00:00Z', { id: 'medium', title: 'Medium Venue Event', venueName: 'The Oscar Larson Performing Arts Center' });
    const ranked = rankTicketmasterEvents([small, medium], 'brookings_sd');
    expect(ranked[0].item.ticketmasterEvent.id).toBe('medium');
    expect(ranked[0].venueTier).toBe('medium');
  });

  it('breaks a same-score, same-date tie by title, regardless of input order', () => {
    const b = tmItem('2026-10-10T18:00:00Z', { id: 'b', title: 'B Event' });
    const a = tmItem('2026-10-10T18:00:00Z', { id: 'a', title: 'A Event' });
    const forward = rankTicketmasterEvents([b, a], 'brookings_sd');
    const reversed = rankTicketmasterEvents([a, b], 'brookings_sd');
    expect(forward.map((r) => r.item.ticketmasterEvent.id)).toEqual(['a', 'b']);
    expect(reversed.map((r) => r.item.ticketmasterEvent.id)).toEqual(['a', 'b']);
  });

  it('is deterministic -- running twice on the same input produces an identical result', () => {
    const items = [
      tmItem('2026-10-24T19:00:00Z', { id: '1', title: 'Event One' }),
      tmItem(null, { id: '2', title: 'Undated Event' }),
      tmItem('2026-09-12T00:00:00Z', { id: '3', title: 'Event Three' }),
    ];
    const first = rankTicketmasterEvents(items, 'brookings_sd');
    const second = rankTicketmasterEvents(items, 'brookings_sd');
    expect(first.map((r) => r.item.ticketmasterEvent.id)).toEqual(second.map((r) => r.item.ticketmasterEvent.id));
  });

  it('sorts undated items last', () => {
    const dated = tmItem('2026-10-24T19:00:00Z', { id: 'dated' });
    const undated = tmItem(null, { id: 'undated' });
    const ranked = rankTicketmasterEvents([undated, dated], 'brookings_sd');
    expect(ranked.map((r) => r.item.ticketmasterEvent.id)).toEqual(['dated', 'undated']);
  });
});

describe('splitMarquee', () => {
  it('splits at the default MARQUEE_SIZE cutoff', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      tmItem('2026-10-24T19:00:00Z', { id: `e${i}`, title: `Event ${i}` }));
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const { marquee, alsoOn } = splitMarquee(ranked);
    expect(marquee).toHaveLength(MARQUEE_SIZE);
    expect(alsoOn).toHaveLength(10 - MARQUEE_SIZE);
  });

  it('puts everything in marquee when the list is shorter than the cutoff', () => {
    const items = [tmItem('2026-10-24T19:00:00Z', { id: '1' }), tmItem('2026-10-25T19:00:00Z', { id: '2' })];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const { marquee, alsoOn } = splitMarquee(ranked);
    expect(marquee).toHaveLength(2);
    expect(alsoOn).toHaveLength(0);
  });

  it('respects a custom cutoff', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      tmItem('2026-10-24T19:00:00Z', { id: `e${i}` }));
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const { marquee, alsoOn } = splitMarquee(ranked, 2);
    expect(marquee).toHaveLength(2);
    expect(alsoOn).toHaveLength(3);
  });

  it('handles an empty ranked list', () => {
    const { marquee, alsoOn } = splitMarquee([]);
    expect(marquee).toEqual([]);
    expect(alsoOn).toEqual([]);
  });
});

describe('ticketmasterSlug', () => {
  it('slugifies a title and appends the Ticketmaster id', () => {
    expect(ticketmasterSlug({ id: 'Z7r9jZ1A70S3p', title: 'A Touring Band Live in Brookings' }))
      .toBe('a-touring-band-live-in-brookings-Z7r9jZ1A70S3p');
  });

  it('produces distinct slugs for two real events sharing an identical title -- confirmed live: "Goosebumps: The Musical" has 5 separate Sioux Falls dates, same title every time', () => {
    const slugA = ticketmasterSlug({ id: 'abc123', title: 'Goosebumps: The Musical' });
    const slugB = ticketmasterSlug({ id: 'def456', title: 'Goosebumps: The Musical' });
    expect(slugA).not.toBe(slugB);
  });

  it('strips punctuation and collapses to single dashes', () => {
    expect(ticketmasterSlug({ id: 'xyz', title: "Dear Evan Hansen!!  (Touring)" }))
      .toBe('dear-evan-hansen-touring-xyz');
  });
});

describe('ticketmasterResolvableImage', () => {
  function tmEvent(overrides: Partial<TicketmasterEvent> = {}): TicketmasterEvent {
    return {
      id: 'tm-1', title: 'A Touring Band', venueId: null, venueName: null,
      venueLatitude: null, venueLongitude: null, venueAddress: null,
      venueCity: null, venueStateCode: null, venuePostalCode: null,
      venueDistanceMiles: null, ticketUrl: 'https://ticketmaster.com/event/tm-1',
      imageUrl: null, imageWidth: null, imageHeight: null,
      priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
      ...overrides,
    };
  }

  it('adapts a Ticketmaster item into a ResolvableStory carrying the image tier fields', () => {
    const item: TicketmasterFeedItem = {
      sourceKind: 'ticketmaster', occurs_at: '2026-10-24T19:00:00Z',
      ticketmasterEvent: tmEvent({
        id: 'tm-42', title: 'A Touring Band',
        imageUrl: 'https://s1.ticketm.net/dam/real.jpg', imageWidth: 2048, imageHeight: 1152,
      }),
    };
    const resolvable = ticketmasterResolvableImage(item);
    expect(resolvable.slug).toBe('a-touring-band-tm-42');
    expect(resolvable.title).toBe('A Touring Band');
    expect(resolvable.ticketmasterImageUrl).toBe('https://s1.ticketm.net/dam/real.jpg');
    expect(resolvable.ticketmasterImageWidth).toBe(2048);
    expect(resolvable.ticketmasterImageHeight).toBe(1152);
    expect(resolvable.image_path).toBeNull();
  });

  it('passes through a null image cleanly (falls through resolveImage()\'s tiers)', () => {
    const item: TicketmasterFeedItem = {
      sourceKind: 'ticketmaster', occurs_at: '2026-10-24T19:00:00Z',
      ticketmasterEvent: tmEvent({ imageUrl: null }),
    };
    const resolvable = ticketmasterResolvableImage(item);
    expect(resolvable.ticketmasterImageUrl).toBeNull();
  });
});
