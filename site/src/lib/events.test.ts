import { describe, expect, it } from 'vitest';
import {
  buildEventFeed, isToday, isThisWeekend, isTonight, isTomorrow, selectTodayBucket,
  isFreeEvent, isLibraryEvent, isKidsEvent, isCampusEvent,
  todayUtcMidnight, utcMidnight, localDateParts, artsEventAsStory,
  type FeedItem,
} from './events';
import type { Story, SdsuEvent, Facility } from './db';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'event',
    source_url: null, occurs_at: null, published_at: '2026-08-23T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null,
    ...overrides,
  };
}

function facility(overrides: Partial<Facility>): Facility {
  return {
    slug: 'x', name: 'X', category: 'other', address: null, phone: null,
    website: null, hours_text: null, description: null, source_url: null,
    verified_date: null, aliases: [], street_address: null, postal_code: null,
    lat: null, lon: null, image_path: null, image_alt: null, name_aliases: [],
    image_attribution_text: null, image_attribution_url: null, free_teaser: null,
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
  return { kind: 'story', occurs_at: s.occurs_at, story: s };
}

describe('date bucketing (timezone-correct, per the Aug-4 weekend-off-by-one regression)', () => {
  // "Today" is Tue Aug 4, 2026 in the reproduced regression -- computing
  // weekdayOfToday via a wrong path shifted it to Monday. Pin the same date.
  const TZ = 'America/Chicago';
  const today = todayUtcMidnight(TZ); // real "now," used only to sanity-check the helper runs

  it('localDateParts/utcMidnight round-trip a known instant correctly for two different timezones', () => {
    // 2026-08-05T04:30:00Z is 2026-08-04 23:30 Central (UTC-5) and
    // 2026-08-04 21:30 Pacific (UTC-7) -- both still Aug 4, never Aug 5.
    const instant = new Date('2026-08-05T04:30:00Z');
    expect(localDateParts(instant, 'America/Chicago')).toEqual({ y: 2026, m: 8, d: 4 });
    expect(localDateParts(instant, 'America/Los_Angeles')).toEqual({ y: 2026, m: 8, d: 4 });
  });

  it('isToday is true for an event later today and false for tomorrow', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 }); // a real Tuesday
    const laterToday = storyItem(story({ occurs_at: '2026-08-04T23:00:00Z' }));
    const tomorrow = storyItem(story({ occurs_at: '2026-08-06T02:00:00Z' })); // Aug 5 21:00 Central
    expect(isToday(laterToday, pinnedToday, 'America/Chicago')).toBe(true);
    expect(isToday(tomorrow, pinnedToday, 'America/Chicago')).toBe(false);
  });

  it('isThisWeekend covers Fri/Sat/Sun relative to a Tuesday "today"', () => {
    const tuesday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const friday = storyItem(story({ occurs_at: '2026-08-07T18:00:00Z' })); // Fri 13:00 Central
    const saturday = storyItem(story({ occurs_at: '2026-08-08T18:00:00Z' }));
    const sunday = storyItem(story({ occurs_at: '2026-08-09T18:00:00Z' }));
    const nextMonday = storyItem(story({ occurs_at: '2026-08-10T18:00:00Z' }));
    const thisTuesday = storyItem(story({ occurs_at: '2026-08-04T18:00:00Z' }));
    expect(isThisWeekend(friday, tuesday, 'America/Chicago')).toBe(true);
    expect(isThisWeekend(saturday, tuesday, 'America/Chicago')).toBe(true);
    expect(isThisWeekend(sunday, tuesday, 'America/Chicago')).toBe(true);
    expect(isThisWeekend(nextMonday, tuesday, 'America/Chicago')).toBe(false);
    expect(isThisWeekend(thisTuesday, tuesday, 'America/Chicago')).toBe(false);
  });

  it('isThisWeekend includes Friday itself when "today" already IS Friday (inclusive, unlike the sequential events.astro bucket)', () => {
    const fridayToday = utcMidnight({ y: 2026, m: 8, d: 7 });
    const laterFriday = storyItem(story({ occurs_at: '2026-08-07T23:00:00Z' }));
    expect(isToday(laterFriday, fridayToday, 'America/Chicago')).toBe(true);
    expect(isThisWeekend(laterFriday, fridayToday, 'America/Chicago')).toBe(true);
  });

  // --- isTonight / isTomorrow (Recurring-traffic layer, Phase 1: /today) ---

  it('isTonight is true after 17:00 local today and false earlier the same day', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const evening = storyItem(story({ occurs_at: '2026-08-04T23:00:00Z' })); // 18:00 Central
    const afternoon = storyItem(story({ occurs_at: '2026-08-04T19:00:00Z' })); // 14:00 Central
    expect(isTonight(evening, pinnedToday, 'America/Chicago')).toBe(true);
    expect(isTonight(afternoon, pinnedToday, 'America/Chicago')).toBe(false);
  });

  it('isTonight includes exactly 17:00 local (inclusive boundary)', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const exactly5pm = storyItem(story({ occurs_at: '2026-08-04T22:00:00Z' })); // 17:00 Central exactly
    expect(isTonight(exactly5pm, pinnedToday, 'America/Chicago')).toBe(true);
  });

  it('isTonight is false for a late event on a different calendar day', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const tomorrowEvening = storyItem(story({ occurs_at: '2026-08-06T02:00:00Z' })); // Aug 5 21:00 Central
    expect(isTonight(tomorrowEvening, pinnedToday, 'America/Chicago')).toBe(false);
  });

  it('isTomorrow is true for the next calendar day only, not today or two days out', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const laterToday = storyItem(story({ occurs_at: '2026-08-04T23:00:00Z' }));
    const tomorrow = storyItem(story({ occurs_at: '2026-08-06T02:00:00Z' })); // Aug 5 21:00 Central
    const dayAfter = storyItem(story({ occurs_at: '2026-08-07T02:00:00Z' })); // Aug 6 21:00 Central
    expect(isTomorrow(laterToday, pinnedToday, 'America/Chicago')).toBe(false);
    expect(isTomorrow(tomorrow, pinnedToday, 'America/Chicago')).toBe(true);
    expect(isTomorrow(dayAfter, pinnedToday, 'America/Chicago')).toBe(false);
  });

  it('isTonight and isTomorrow are false for an item with no occurs_at', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const noDate = storyItem(story({ occurs_at: null }));
    expect(isTonight(noDate, pinnedToday, 'America/Chicago')).toBe(false);
    expect(isTomorrow(noDate, pinnedToday, 'America/Chicago')).toBe(false);
  });

  it('selectTodayBucket caps items but reports the real total', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const items = Array.from({ length: 7 }, (_, i) =>
      storyItem(story({ slug: `evening-${i}`, occurs_at: '2026-08-04T23:00:00Z' })));
    const bucket = selectTodayBucket(items, pinnedToday, 'America/Chicago', isTonight, 5);
    expect(bucket.items).toHaveLength(5);
    expect(bucket.total).toBe(7);
  });

  it('selectTodayBucket excludes non-matching items from both the list and the count', () => {
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const tonight = storyItem(story({ slug: 'tonight', occurs_at: '2026-08-04T23:00:00Z' }));
    const tomorrow = storyItem(story({ slug: 'tomorrow', occurs_at: '2026-08-06T02:00:00Z' }));
    const bucket = selectTodayBucket([tonight, tomorrow], pinnedToday, 'America/Chicago', isTonight, 5);
    expect(bucket.items).toEqual([tonight]);
    expect(bucket.total).toBe(1);
  });

  it('a late-evening Pacific event is not shifted to the wrong calendar day', () => {
    // 23:00 Pacific on Aug 8 is 06:00 UTC on Aug 9 -- must still bucket as Aug 8.
    const pinnedToday = utcMidnight({ y: 2026, m: 8, d: 4 });
    const lateSaturday = storyItem(story({ occurs_at: '2026-08-09T06:00:00Z' }));
    expect(isThisWeekend(lateSaturday, pinnedToday, 'America/Los_Angeles')).toBe(true);
  });

  it('todayUtcMidnight runs without throwing for both site timezones', () => {
    expect(today instanceof Date).toBe(true);
    expect(todayUtcMidnight('America/Los_Angeles') instanceof Date).toBe(true);
  });
});

describe('buildEventFeed cross-source dedup', () => {
  it('collapses a same-day, exact-title match across story/arts kinds, keeping the story as canonical', () => {
    const s = story({ slug: 'downtown-at-sundown', title: 'Downtown at Sundown', occurs_at: '2026-08-07T20:00:00Z', source_url: 'https://visitbrookingssd.com/events/1' });
    const a = artsEvent({ external_event_id: 'sdsu-99', title: 'Downtown @ Sundown', starts_at: '2026-08-07T20:00:00Z', event_url: 'https://sdstate.edu/events/99' });
    const { items, alsoListedBy } = buildEventFeed([s], [a], 'America/Chicago');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('story');
    expect(alsoListedBy.get(items[0])).toEqual(['sdstate.edu']);
  });

  it('does NOT collapse two same-kind, same-day, same-title events (real library double session)', () => {
    const s1 = story({ slug: 'teens-1', title: 'Teens in the Kitchen', occurs_at: '2026-08-07T18:00:00Z' });
    const s2 = story({ slug: 'teens-2', title: 'Teens in the Kitchen', occurs_at: '2026-08-07T21:00:00Z' });
    const { items } = buildEventFeed([s1, s2], [], 'America/Chicago');
    expect(items).toHaveLength(2);
  });

  it('sorts by occurs_at ascending, undated items last', () => {
    const later = story({ slug: 'b', occurs_at: '2026-08-10T12:00:00Z' });
    const earlier = story({ slug: 'a', occurs_at: '2026-08-05T12:00:00Z' });
    const undated = story({ slug: 'c', occurs_at: null });
    const { items } = buildEventFeed([later, earlier, undated], [], 'America/Chicago');
    expect(items.map((i) => (i.kind === 'story' ? i.story.slug : ''))).toEqual(['a', 'b', 'c']);
  });
});

describe('isFreeEvent', () => {
  const facilities: Facility[] = [
    facility({ slug: 'library', name: 'Brookings Public Library', category: 'library', aliases: ['brookings public library'] }),
    facility({ slug: 'park', name: 'Dakota Nature Park', category: 'park', aliases: ['dakota nature park'] }),
    facility({ slug: 'theatre', name: 'Brookings Cinema 8', category: 'other', aliases: ['brookings cinema 8'] }),
  ];

  it('is true for an event at a library-category facility', () => {
    const item = storyItem(story({ venue_raw: 'Brookings Public Library, 515 3rd St' }));
    expect(isFreeEvent(item, facilities)).toBe(true);
  });

  it('is true for an event at a park-category facility', () => {
    const item = storyItem(story({ venue_raw: 'Dakota Nature Park' }));
    expect(isFreeEvent(item, facilities)).toBe(true);
  });

  it('is false when the venue resolves to a non-free category', () => {
    const item = storyItem(story({ venue_raw: 'Brookings Cinema 8' }));
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  it('is false when the venue does not resolve at all -- never guessed', () => {
    const item = storyItem(story({ venue_raw: 'Some Unknown Hall' }));
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  it('is false for an SDSU arts event even with no venue data -- campus venues are never in the town facilities registry', () => {
    const item: FeedItem = { kind: 'arts', occurs_at: '2026-08-07T20:00:00Z', event: artsEvent({}) };
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  it('the paid-language safety net excludes a library event whose body mentions a ticket price', () => {
    const item = storyItem(story({
      venue_raw: 'Brookings Public Library',
      body: 'Admission is $5 at the door, tickets required.',
    }));
    expect(isFreeEvent(item, facilities)).toBe(false);
  });
});

describe('isLibraryEvent', () => {
  const facilities: Facility[] = [
    facility({ slug: 'library', name: 'Moreno Valley Public Library', category: 'library', aliases: ['moreno valley public library'] }),
  ];

  it('is true when venue resolves to the library', () => {
    const item = storyItem(story({ venue_raw: 'Moreno Valley Public Library' }));
    expect(isLibraryEvent(item, facilities)).toBe(true);
  });

  it('is false for an unresolved venue', () => {
    const item = storyItem(story({ venue_raw: 'City Hall Annex' }));
    expect(isLibraryEvent(item, facilities)).toBe(false);
  });
});

describe('isKidsEvent', () => {
  it('matches on an obvious title keyword', () => {
    expect(isKidsEvent(storyItem(story({ title: 'Toddler Time' })))).toBe(true);
    expect(isKidsEvent(storyItem(story({ title: 'Family Movie Night' })))).toBe(true);
  });

  it('does not match an ordinary adult program', () => {
    expect(isKidsEvent(storyItem(story({ title: 'Book Club: Nonfiction Picks', body: 'Monthly discussion for adult readers.' })))).toBe(false);
  });

  it('checks the arts-event teaser too', () => {
    const item: FeedItem = { kind: 'arts', occurs_at: null, event: artsEvent({ title: 'Family Weekend Concert', teaser: 'Bring the kids for a fun afternoon.' }) };
    expect(isKidsEvent(item)).toBe(true);
  });
});

describe('isCampusEvent', () => {
  it('is true only for arts-kind items', () => {
    const arts: FeedItem = { kind: 'arts', occurs_at: null, event: artsEvent({}) };
    const regular = storyItem(story({}));
    expect(isCampusEvent(arts)).toBe(true);
    expect(isCampusEvent(regular)).toBe(false);
  });
});

describe('artsEventAsStory', () => {
  it('adapts the fields StoryCard/JSON-LD need without inventing any', () => {
    const s = artsEventAsStory(artsEvent({ title: 'Jazz Night', starts_at: '2026-08-07T20:00:00Z', teaser: 'Live jazz on the quad.' }));
    expect(s.title).toBe('Jazz Night');
    expect(s.body).toBe('Live jazz on the quad.');
    expect(s.occurs_at).toBe('2026-08-07T20:00:00Z');
    expect(s.source_type).toBe('event');
  });
});
