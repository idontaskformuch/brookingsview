import { describe, it, expect } from 'vitest';
import { rankEvents } from './event-ranking';
import type { FeedItem, EventFeedResult } from './events';
import type { Story, SdsuEvent } from './db';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'event',
    source_url: null, occurs_at: null, published_at: '2026-08-23T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null,
    ...overrides,
  };
}

function artsEvent(overrides: Partial<SdsuEvent>): SdsuEvent {
  return {
    external_event_id: 'sdsu-1', title: 'Untitled', teaser: null, location: null,
    starts_at: null, ends_at: null, categories: [], primary_category: null,
    event_url: 'https://sdstate.edu/events/x',
    ...overrides,
  };
}

function storyItem(s: Story): FeedItem {
  return { sourceKind: 'story', occurs_at: s.occurs_at, story: s };
}

function artsItem(e: SdsuEvent): FeedItem {
  return { sourceKind: 'arts', occurs_at: e.starts_at, event: e };
}

function feed(items: FeedItem[], alsoListedBy: Map<FeedItem, string[]> = new Map()): EventFeedResult {
  return { items, alsoListedBy };
}

describe('rankEvents', () => {
  it('returns [] for an empty feed', () => {
    expect(rankEvents(feed([]), 'brookings_sd')).toEqual([]);
  });

  it('handles a single-event feed without erroring', () => {
    const item = artsItem(artsEvent({ title: 'Solo Recital', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));
    const ranked = rankEvents(feed([item]), 'brookings_sd');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].item).toBe(item);
  });

  it('respects venue tier ordering when nothing else differs', () => {
    // Brookings' SDSU arts_culture venues (looked up by name only -- this
    // source has no venue-id concept, unlike Ticketmaster) currently top
    // out at 'medium': the Oscar Larson Performing Arts Center was revised
    // down from 'large' in the What's On Phase 5 follow-up ("Radius Fix"
    // review) once its real capacity (1,000 seats, its largest hall) was
    // checked against the newly-curated real Sioux Falls venues and found
    // smaller than several of them -- see lib/venue-tiers.ts's own comment.
    // The 3-way large/medium/small ordering proof now lives in
    // whats-on.test.ts, against Denny Sanford PREMIER Center (the one
    // genuinely large venue in this town's tier system today, curated by
    // Ticketmaster's own venue id).
    const small = artsItem(artsEvent({ title: 'Small Venue Event', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));
    const medium = artsItem(artsEvent({ title: 'Medium Venue Event', location: 'University Student Union', starts_at: '2026-09-10T18:00:00Z' }));
    const alsoMedium = artsItem(artsEvent({ title: 'Also Medium Venue Event', location: 'The Oscar Larson Performing Arts Center', starts_at: '2026-09-10T18:00:00Z' }));
    const ranked = rankEvents(feed([small, medium, alsoMedium]), 'brookings_sd');
    expect(ranked.map((r) => r.venueTier).sort()).toEqual(['medium', 'medium', 'small']);
    expect(ranked[ranked.length - 1].venueTier).toBe('small');
  });

  it('boosts a cross-matched item above a same-tier item with no cross-match', () => {
    const crossMatched = artsItem(artsEvent({ title: 'Downtown at Sundown', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));
    const solo = artsItem(artsEvent({ title: 'Regular Recital', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));
    const alsoListedBy = new Map<FeedItem, string[]>([[crossMatched, ['visitbrookingssd.com']]]);
    const ranked = rankEvents(feed([solo, crossMatched], alsoListedBy), 'brookings_sd');
    expect(ranked[0].item).toBe(crossMatched);
    expect(ranked[0].crossMatchCount).toBe(1);
    expect(ranked[1].crossMatchCount).toBe(0);
  });

  it('an unranked/unknown venue falls back to the lowest tier, never crashing or outranking a known venue', () => {
    const unknown = artsItem(artsEvent({ title: 'Mystery Venue Event', location: 'Some Brand New Building', starts_at: '2026-09-10T18:00:00Z' }));
    const known = artsItem(artsEvent({ title: 'Known Venue Event', location: 'The Oscar Larson Performing Arts Center', starts_at: '2026-09-10T18:00:00Z' }));
    const ranked = rankEvents(feed([unknown, known]), 'brookings_sd');
    expect(ranked[0].item).toBe(known);
    expect(ranked[1].venueTier).toBe('small');
  });

  it('breaks a same-score tie by soonest occurs_at, then by title, regardless of input order', () => {
    const later = artsItem(artsEvent({ title: 'B Event', location: 'Lincoln Hall', starts_at: '2026-09-12T18:00:00Z' }));
    const sooner = artsItem(artsEvent({ title: 'A Event', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));
    const sameTimeA = artsItem(artsEvent({ title: 'Zebra Event', location: 'Lincoln Hall', starts_at: '2026-09-10T18:00:00Z' }));

    const forward = rankEvents(feed([later, sooner]), 'brookings_sd');
    expect(forward.map((r) => itemTitleOf(r))).toEqual(['A Event', 'B Event']);

    const reversed = rankEvents(feed([sooner, later]), 'brookings_sd');
    expect(reversed.map((r) => itemTitleOf(r))).toEqual(['A Event', 'B Event']);

    // Same date+tier+cross-match as `sooner` -- title breaks the remaining tie.
    const titleTie = rankEvents(feed([sameTimeA, sooner]), 'brookings_sd');
    expect(titleTie.map((r) => itemTitleOf(r))).toEqual(['A Event', 'Zebra Event']);
  });

  it('is deterministic -- running twice on the same input produces an identical result', () => {
    const items = [
      artsItem(artsEvent({ title: 'Event One', location: 'University Student Union', starts_at: '2026-09-10T18:00:00Z', external_event_id: '1' })),
      storyItem(story({ title: 'Event Two', venue_raw: 'South Dakota Art Museum', occurs_at: '2026-09-11T18:00:00Z', slug: 'event-two' })),
      artsItem(artsEvent({ title: 'Event Three', location: null, starts_at: '2026-09-09T18:00:00Z', external_event_id: '3' })),
    ];
    const first = rankEvents(feed(items), 'brookings_sd');
    const second = rankEvents(feed(items), 'brookings_sd');
    expect(first.map((r) => ({ title: itemTitleOf(r), score: r.score }))).toEqual(
      second.map((r) => ({ title: itemTitleOf(r), score: r.score })),
    );
  });
});

function itemTitleOf(r: { item: FeedItem }): string {
  return r.item.sourceKind === 'story' ? r.item.story.title : r.item.event.title;
}
