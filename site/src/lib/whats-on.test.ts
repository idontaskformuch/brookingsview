import { describe, it, expect } from 'vitest';
import {
  rankTicketmasterEvents, splitMarquee, collapseMarqueeRuns, MARQUEE_SIZE,
  ticketmasterSlug, ticketmasterResolvableImage, isWhatsOnIntroFresh,
} from './whats-on';
import type { TicketmasterFeedItem, TicketmasterEvent } from './ticketmaster';

function tmEvent(overrides: Partial<TicketmasterEvent> = {}): TicketmasterEvent {
  return {
    id: 'tm-1', title: 'Untitled Event', attractionId: null, venueId: null, venueName: null,
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

  it('respects venue tier when a venue IS curated by id (What\'s On Phase 5 follow-up: real Sioux Falls venues, was previously uncurated)', () => {
    const small = tmItem('2026-10-10T18:00:00Z', { id: 'small', title: 'Small Venue Event', venueName: 'BIGS Sports Bar', venueId: 'rZ7HnEZ178s_A' });
    const large = tmItem('2026-10-10T18:00:00Z', { id: 'large', title: 'Large Venue Event', venueName: 'Denny Sanford PREMIER Center', venueId: 'KovZpZAJAl7A' });
    const ranked = rankTicketmasterEvents([small, large], 'brookings_sd');
    expect(ranked[0].item.ticketmasterEvent.id).toBe('large');
    expect(ranked[0].venueTier).toBe('large');
  });

  it('a real touring act at a later date correctly outranks a sooner small-venue show, once the venue is curated -- the exact case the Phase 5 human review found inverted before this fix', () => {
    const soonerSmall = tmItem('2026-09-12T00:00:00Z', { id: 'small', title: 'DECAYSTATE', venueName: 'Icon Events & Dada Gastropub', venueId: 'rZ7HnEZ178xxA' });
    const laterLarge = tmItem('2026-10-25T00:00:00Z', { id: 'large', title: 'Zac Brown Band', venueName: 'Denny Sanford PREMIER Center', venueId: 'KovZpZAJAl7A' });
    const ranked = rankTicketmasterEvents([soonerSmall, laterLarge], 'brookings_sd');
    expect(ranked[0].item.ticketmasterEvent.id).toBe('large');
  });

  it('still resolves the correct tier by name alone, with no venueId at all -- the name-keyed fallback added after a real confirmed case (Denny Sanford PREMIER Center has two different Discovery API venue ids for the same building) means id instability degrades to name matching, not straight to the default', () => {
    const large = tmItem('2026-10-24T19:00:00Z', { id: 'large', title: 'Later Event', venueName: 'Denny Sanford PREMIER Center' });
    const medium = tmItem('2026-09-12T00:00:00Z', { id: 'medium', title: 'Sooner Event', venueName: 'Washington Pavilion of Arts & Science' });
    const ranked = rankTicketmasterEvents([large, medium], 'brookings_sd');
    expect(ranked[0].item.ticketmasterEvent.id).toBe('large');
    expect(ranked[0].venueTier).toBe('large');
    expect(ranked[1].venueTier).toBe('medium');
  });

  it('genuinely degrades to pure date ordering only for a venue never observed at all -- neither id nor name curated', () => {
    const later = tmItem('2026-10-24T19:00:00Z', { id: 'later', title: 'Later Event', venueName: 'Some Brand New Sioux Falls Venue' });
    const sooner = tmItem('2026-09-12T00:00:00Z', { id: 'sooner', title: 'Sooner Event', venueName: 'Another Uncurated Venue' });
    const ranked = rankTicketmasterEvents([later, sooner], 'brookings_sd');
    expect(ranked.every((r) => r.venueTier === 'small')).toBe(true);
    expect(ranked.map((r) => r.item.ticketmasterEvent.id)).toEqual(['sooner', 'later']);
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

describe('collapseMarqueeRuns (What\'s On Phase 5 follow-up, "Tour-Run Collapsing")', () => {
  it('collapses N events sharing the same attractionId AND venueId into one entry, primary = soonest date', () => {
    const items = [
      tmItem('2026-12-06T19:00:00Z', { id: 'stop2', title: 'Disney On Ice presents Find Your Hero', attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A' }),
      tmItem('2026-12-05T16:00:00Z', { id: 'stop1', title: 'Disney On Ice presents Find Your Hero', attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A' }),
      tmItem('2026-12-06T23:00:00Z', { id: 'stop3', title: 'Disney On Ice presents Find Your Hero', attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A' }),
    ];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(1);
    expect(entries[0].primary.ticketmasterEvent.id).toBe('stop1'); // soonest
    expect(entries[0].members).toHaveLength(3);
  });

  it('does NOT collapse events by different attractions at the same venue', () => {
    const items = [
      tmItem('2026-12-05T16:00:00Z', { id: 'a', title: 'Show A', attractionId: 'attraction-a', venueId: 'same-venue' }),
      tmItem('2026-12-06T16:00:00Z', { id: 'b', title: 'Show B', attractionId: 'attraction-b', venueId: 'same-venue' }),
    ];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(2);
  });

  it('does NOT collapse the same attraction at two DIFFERENT venues -- two separate bookings, not one run', () => {
    const items = [
      tmItem('2026-12-05T16:00:00Z', { id: 'a', title: 'Touring Show', attractionId: 'same-attraction', venueId: 'venue-1' }),
      tmItem('2026-12-06T16:00:00Z', { id: 'b', title: 'Touring Show', attractionId: 'same-attraction', venueId: 'venue-2' }),
    ];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(2);
  });

  it('never collapses events with no attractionId at all, even if everything else matches', () => {
    const items = [
      tmItem('2026-12-05T16:00:00Z', { id: 'a', title: 'Same Title', venueId: 'same-venue' }),
      tmItem('2026-12-06T16:00:00Z', { id: 'b', title: 'Same Title', venueId: 'same-venue' }),
    ];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(2);
  });

  it('a standalone event with an attractionId still gets its own single-member entry', () => {
    const items = [tmItem('2026-12-05T16:00:00Z', { id: 'solo', attractionId: 'unique-attraction', venueId: 'v1' })];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(1);
    expect(entries[0].members).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(collapseMarqueeRuns([])).toEqual([]);
  });

  it('falls back to venue NAME when venueId is absent, still requiring a match on both', () => {
    const items = [
      tmItem('2026-12-05T16:00:00Z', { id: 'a', title: 'Touring Show', attractionId: 'attr-1', venueName: 'Some Venue' }),
      tmItem('2026-12-06T16:00:00Z', { id: 'b', title: 'Touring Show', attractionId: 'attr-1', venueName: 'Some Venue' }),
    ];
    const ranked = rankTicketmasterEvents(items, 'brookings_sd');
    const entries = collapseMarqueeRuns(ranked);
    expect(entries).toHaveLength(1);
    expect(entries[0].members).toHaveLength(2);
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

  it('a collapsed run occupies exactly one Marquee slot, freeing room for other distinct acts -- the exact crowding bug this follow-up fixes', () => {
    // Same real shape as the live problem: 6 same-run large-tier events plus
    // 4 other DISTINCT large-tier acts (no attractionId -- distinct
    // one-off shows), all at the same curated venue so they tie on tier
    // and would otherwise compete on date order alone.
    const runStops = Array.from({ length: 6 }, (_, i) =>
      tmItem(`2026-12-0${i + 1}T16:00:00Z`, {
        id: `run-${i}`, title: 'Disney On Ice presents Find Your Hero',
        attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A', venueName: 'Denny Sanford PREMIER Center',
      }));
    const distinctActs = ['Jonas Brothers', 'Lindsey Stirling', 'Bert Kreischer', 'TobyMac'].map((title, i) =>
      tmItem(`2026-12-1${i}T16:00:00Z`, {
        id: `distinct-${i}`, title, venueId: 'KovZpZAJAl7A', venueName: 'Denny Sanford PREMIER Center',
      }));
    const ranked = rankTicketmasterEvents([...runStops, ...distinctActs], 'brookings_sd');
    const { marquee } = splitMarquee(ranked); // default cutoff, 6

    // Without collapsing this would be 6 Disney On Ice cards. With it, the
    // run takes ONE slot and all 4 distinct acts fit too (5 total entries).
    expect(marquee).toHaveLength(5);
    const marqueeTitles = marquee.map((entry) => entry.primary.ticketmasterEvent.title);
    expect(marqueeTitles).toContain('Jonas Brothers');
    expect(marqueeTitles).toContain('Lindsey Stirling');
    expect(marqueeTitles).toContain('Bert Kreischer');
    expect(marqueeTitles).toContain('TobyMac');
    const disneyEntry = marquee.find((entry) => entry.primary.ticketmasterEvent.title.includes('Disney'));
    expect(disneyEntry?.members).toHaveLength(6);
  });

  it('Also-On is NOT collapsed -- non-primary run members still appear individually, each a real bookable date', () => {
    const runStops = Array.from({ length: 3 }, (_, i) =>
      tmItem(`2026-12-0${i + 1}T16:00:00Z`, {
        id: `run-${i}`, title: 'Touring Show', attractionId: 'attr-1', venueId: 'v1',
      }));
    const ranked = rankTicketmasterEvents(runStops, 'brookings_sd');
    const { marquee, alsoOn } = splitMarquee(ranked, 1); // cutoff=1: run's primary fills the only slot
    expect(marquee).toHaveLength(1);
    expect(marquee[0].members).toHaveLength(3);
    // The other 2 dates are NOT hidden -- they still show individually in Also-On.
    expect(alsoOn.map((i) => i.ticketmasterEvent.id).sort()).toEqual(['run-1', 'run-2']);
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
      id: 'tm-1', title: 'A Touring Band', attractionId: null, venueId: null, venueName: null,
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

describe('isWhatsOnIntroFresh (What\'s On Phase 6b)', () => {
  it('is fresh when both isoYear and isoWeek match', () => {
    expect(isWhatsOnIntroFresh({ isoYear: 2026, isoWeek: 37 }, { isoYear: 2026, isoWeek: 37 })).toBe(true);
  });

  it('is stale when isoWeek differs -- last week\'s intro above this week\'s listing', () => {
    expect(isWhatsOnIntroFresh({ isoYear: 2026, isoWeek: 36 }, { isoYear: 2026, isoWeek: 37 })).toBe(false);
  });

  it('is stale when isoYear differs even if isoWeek number matches (year-boundary case)', () => {
    expect(isWhatsOnIntroFresh({ isoYear: 2025, isoWeek: 37 }, { isoYear: 2026, isoWeek: 37 })).toBe(false);
  });
});
