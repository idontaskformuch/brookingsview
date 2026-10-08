import { describe, expect, it } from 'vitest';
import {
  buildEventFeed, isToday, isThisWeekend, isTonight, isTomorrow, selectTodayBucket,
  isFreeEvent, isLibraryEvent, isKidsEvent, isCampusEvent, isOutdoorEvent, classifyEventLocality,
  findCrossSourceMatch, eventPriceAgeLine,
  todayUtcMidnight, utcMidnight, localDateParts, artsEventAsStory, dayIndex,
  EVENT_SOURCES,
  type FeedItem, type EventSourceConfig,
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
    id: 0, slug: 'x', name: 'X', category: 'other', address: null, phone: null,
    website: null, hours_text: null, description: null, source_url: null,
    verified_date: null, aliases: [], street_address: null, postal_code: null,
    lat: null, lon: null, image_path: null, image_alt: null, name_aliases: [],
    image_attribution_text: null, image_attribution_url: null, image_needs_review: false,
    free_teaser: null, hours_structured: null, hours_needs_review: false,
    is_free: null, fee_note: null, accessibility_note: null, services: null,
    verification_method: null, hours_confidence: null,
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

describe('dayIndex bucketing -- all three real site timezones (Events correctness Phase 1, 2026-10-07)', () => {
  // index.astro's homepage Today/This-week/Later story river used to bucket
  // via `new Date().setHours(0,0,0,0)` -- the BUILD MACHINE's local time
  // (always UTC in CI/Cloudflare, never the town's own zone). All three
  // real site timezones are west of UTC, so an evening local event rolled
  // into the next UTC calendar day and silently fell out of "Today." The
  // fix routes index.astro through this same dayIndex() (exported for
  // exactly that reason) rather than a second hand-rolled copy, so these
  // cases exercise the one shared primitive directly instead of only one
  // of its existing callers (isToday/isTonight/etc., tested above).
  //
  // Every occurs_at below is a real local-wall-clock-to-UTC conversion for
  // the stated IANA zone (cross-checked against Intl.DateTimeFormat, not
  // hand-computed), covering Brookings (America/Chicago), Moreno Valley
  // (America/Los_Angeles) and Broomfield (America/Denver) -- the three
  // actual site timezones, per the handoff's explicit requirement.

  describe('evening events land on today, not tomorrow', () => {
    const today = utcMidnight({ y: 2026, m: 8, d: 4 }); // an ordinary Tuesday, no DST nearby

    it.each([
      ['America/Chicago', '18:00', '2026-08-04T23:00:00.000Z'],
      ['America/Chicago', '21:00', '2026-08-05T02:00:00.000Z'],
      ['America/Chicago', '23:30', '2026-08-05T04:30:00.000Z'],
      ['America/Los_Angeles', '18:00', '2026-08-05T01:00:00.000Z'],
      ['America/Los_Angeles', '21:00', '2026-08-05T04:00:00.000Z'],
      ['America/Los_Angeles', '23:30', '2026-08-05T06:30:00.000Z'],
      ['America/Denver', '18:00', '2026-08-05T00:00:00.000Z'],
      ['America/Denver', '21:00', '2026-08-05T03:00:00.000Z'],
      ['America/Denver', '23:30', '2026-08-05T05:30:00.000Z'],
    ])('%s %s local -> offset 0 (today)', (tz, _label, occursAt) => {
      expect(dayIndex(occursAt, today, tz)).toBe(0);
    });
  });

  describe('an event just after local midnight lands on tomorrow, not today', () => {
    const today = utcMidnight({ y: 2026, m: 8, d: 4 });

    it.each([
      ['America/Chicago', '2026-08-05T05:30:00.000Z'],
      ['America/Los_Angeles', '2026-08-05T07:30:00.000Z'],
      ['America/Denver', '2026-08-05T06:30:00.000Z'],
    ])('%s 00:30 local -> offset 1 (tomorrow)', (tz, occursAt) => {
      expect(dayIndex(occursAt, today, tz)).toBe(1);
    });
  });

  describe('spring-forward DST boundary (2026-03-08) does not shift bucketing', () => {
    it.each([
      ['America/Chicago', '2026-03-09T02:00:00.000Z'],
      ['America/Los_Angeles', '2026-03-09T04:00:00.000Z'],
      ['America/Denver', '2026-03-09T03:00:00.000Z'],
    ])('%s: "today" the day before the transition, a 21:00-local event ON the transition day is tomorrow (offset 1)', (tz, occursAt) => {
      const today = utcMidnight({ y: 2026, m: 3, d: 7 });
      expect(dayIndex(occursAt, today, tz)).toBe(1);
    });

    it.each([
      ['America/Chicago', '2026-03-10T02:00:00.000Z'],
      ['America/Los_Angeles', '2026-03-10T04:00:00.000Z'],
      ['America/Denver', '2026-03-10T03:00:00.000Z'],
    ])('%s: "today" IS the transition day, a 21:00-local event the day after is tomorrow (offset 1)', (tz, occursAt) => {
      const today = utcMidnight({ y: 2026, m: 3, d: 8 });
      expect(dayIndex(occursAt, today, tz)).toBe(1);
    });
  });

  describe('fall-back DST boundary (2026-11-01) does not shift bucketing', () => {
    it.each([
      ['America/Chicago', '2026-11-02T03:00:00.000Z'],
      ['America/Los_Angeles', '2026-11-02T05:00:00.000Z'],
      ['America/Denver', '2026-11-02T04:00:00.000Z'],
    ])('%s: "today" the day before the transition, a 21:00-local event ON the transition day is tomorrow (offset 1)', (tz, occursAt) => {
      const today = utcMidnight({ y: 2026, m: 10, d: 31 });
      expect(dayIndex(occursAt, today, tz)).toBe(1);
    });

    it.each([
      ['America/Chicago', '2026-11-03T03:00:00.000Z'],
      ['America/Los_Angeles', '2026-11-03T05:00:00.000Z'],
      ['America/Denver', '2026-11-03T04:00:00.000Z'],
    ])('%s: "today" IS the transition day, a 21:00-local event the day after is tomorrow (offset 1)', (tz, occursAt) => {
      const today = utcMidnight({ y: 2026, m: 11, d: 1 });
      expect(dayIndex(occursAt, today, tz)).toBe(1);
    });
  });

  describe('all-day events (local midnight occurs_at, per scrapers/event_sources.py\'s floating-time rule) stay on their own date', () => {
    // An all-day iCal VEVENT (DTSTART with no time component) is stored as
    // local midnight of its date -- see scrapers/event_sources.py's
    // _to_iso() and tests/test_event_sources.py's
    // test_parse_ical_all_day_event_uses_local_midnight_not_utc_midnight.
    // These are that same instant, one per town, confirming the frontend
    // bucketing side agrees without needing its own special case.
    it.each([
      ['America/Chicago', '2026-09-30T05:00:00.000Z'],
      ['America/Los_Angeles', '2026-09-30T07:00:00.000Z'],
      ['America/Denver', '2026-09-30T06:00:00.000Z'],
    ])('%s: an all-day event dated 2026-09-30 buckets as 2026-09-30 (offset 0)', (tz, occursAt) => {
      const today = utcMidnight({ y: 2026, m: 9, d: 30 });
      expect(dayIndex(occursAt, today, tz)).toBe(0);
    });
  });
});

describe('buildEventFeed cross-source dedup', () => {
  it('collapses a same-day, exact-title match across story/arts kinds, keeping the story as canonical', () => {
    const s = story({ slug: 'downtown-at-sundown', title: 'Downtown at Sundown', occurs_at: '2026-08-07T20:00:00Z', source_url: 'https://visitbrookingssd.com/events/1' });
    const a = artsEvent({ external_event_id: 'sdsu-99', title: 'Downtown @ Sundown', starts_at: '2026-08-07T20:00:00Z', event_url: 'https://sdstate.edu/events/99' });
    const { items, alsoListedBy } = buildEventFeed([s], [a], 'America/Chicago');
    expect(items).toHaveLength(1);
    expect(items[0].sourceKind).toBe('story');
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
    expect(items.map((i) => (i.sourceKind === 'story' ? i.story.slug : ''))).toEqual(['a', 'b', 'c']);
  });
});

describe('findCrossSourceMatch (What\'s On Phase 1: n-source generalization)', () => {
  // Synthetic 3-source config -- proves the matching logic genuinely
  // generalizes past two hardcoded literals, without requiring a real third
  // production source (e.g. Ticketmaster) to exist yet. Plain string keys
  // and a Map<string, string> stand in for FeedItem/canonicalByKey here --
  // findCrossSourceMatch() only needs a sourceKind, a dateKey, a normalized
  // title, and a lookup map, never the concrete story/arts payload shape.
  const THREE_SOURCES: Record<string, EventSourceConfig> = {
    story: { crossMatch: true },
    arts: { crossMatch: true },
    ticketmaster: { crossMatch: true },
  };

  it('does not match a same-date entry from another source when the title differs', () => {
    const canonicalByKey = new Map<string, string>([
      ['2026-08-07|arts', 'the-arts-item'], // deliberately malformed/unrelated key -- must never be hit
      ['2026-08-07|arts|a completely different event', 'the-arts-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-08-07', 'downtown at sundown', canonicalByKey, THREE_SOURCES))
      .toBeUndefined();
  });

  it('finds a match from a second source when a third is also configured', () => {
    const canonicalByKey = new Map<string, string>([
      ['2026-08-07|story|downtown at sundown', 'the-story-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-08-07', 'downtown at sundown', canonicalByKey, THREE_SOURCES))
      .toBe('the-story-item');
  });

  it('never matches within the same source, regardless of source count', () => {
    const canonicalByKey = new Map<string, string>([
      ['2026-08-07|ticketmaster|downtown at sundown', 'first-ticketmaster-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-08-07', 'downtown at sundown', canonicalByKey, THREE_SOURCES))
      .toBeUndefined();
  });

  it('a source with crossMatch:false never matches and is never matched into', () => {
    const sources: Record<string, EventSourceConfig> = {
      story: { crossMatch: true },
      ticketmaster: { crossMatch: false },
    };
    const canonicalByKey = new Map<string, string>([
      ['2026-08-07|story|downtown at sundown', 'the-story-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-08-07', 'downtown at sundown', canonicalByKey, sources))
      .toBeUndefined();
  });

  it('returns undefined for an undated item regardless of source count', () => {
    const canonicalByKey = new Map<string, string>([['2026-08-07|story|x', 'y']]);
    expect(findCrossSourceMatch('arts', null, 'x', canonicalByKey, THREE_SOURCES)).toBeUndefined();
  });
});

describe('EVENT_SOURCES + Ticketmaster cross-match sanity check (What\'s On Phase 3)', () => {
  // Real title, captured live from Discovery API for Brookings, SD on
  // 2026-09-07 -- see lib/ticketmaster.test.ts's realFixture(). Ticketmaster's
  // own convention (long, formal, "Team A vs. Team B [Sport]") is far more
  // verbose than how an arts_culture/city feed would plausibly describe the
  // same real-world event.
  const REAL_TICKETMASTER_TITLE = 'South Dakota State Jackrabbits Football vs. Murray State Racers Football';
  // A plausible (constructed, not real -- Athletics isn't in the
  // arts_culture bucket buildEventFeed() actually reads, so no live
  // counterpart exists to compare against) title a city/arts calendar might
  // use for the SAME real game.
  const PLAUSIBLE_ARTS_CALENDAR_TITLE = 'Jackrabbits Football vs Murray State';

  function normalize(title: string): string {
    return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  it('ticketmaster is registered with crossMatch enabled in the real production config', () => {
    expect(EVENT_SOURCES.ticketmaster).toEqual({ crossMatch: true });
  });

  it('the mechanism DOES merge a ticketmaster item when its title exactly matches another source (proves it works when titles align)', () => {
    const canonicalByKey = new Map<string, string>([
      [`2026-10-24|story|${normalize(REAL_TICKETMASTER_TITLE)}`, 'the-story-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-10-24', normalize(REAL_TICKETMASTER_TITLE), canonicalByKey, EVENT_SOURCES))
      .toBe('the-story-item');
  });

  it('a real Ticketmaster title does NOT merge against a plausibly-phrased same-event title from another source -- a safe miss (two cards), never a wrong merge, documenting the real limitation', () => {
    const canonicalByKey = new Map<string, string>([
      [`2026-10-24|story|${normalize(PLAUSIBLE_ARTS_CALENDAR_TITLE)}`, 'the-story-item'],
    ]);
    expect(findCrossSourceMatch('ticketmaster', '2026-10-24', normalize(REAL_TICKETMASTER_TITLE), canonicalByKey, EVENT_SOURCES))
      .toBeUndefined();
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
    const item: FeedItem = { sourceKind: 'arts', occurs_at: '2026-08-07T20:00:00Z', event: artsEvent({}) };
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  it('the paid-language safety net excludes a library event whose body mentions a ticket price', () => {
    const item = storyItem(story({
      venue_raw: 'Brookings Public Library',
      body: 'Admission is $5 at the door, tickets required.',
    }));
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  // Events correctness Step A, point 3: body can no longer carry a dollar
  // amount at all (guardrails.py's check_no_date_time_price_age_claims),
  // so meta.cost is now the only place that signal can still appear.
  it('the paid-language safety net also excludes a library event whose meta.cost names a price', () => {
    const item = storyItem(story({
      venue_raw: 'Brookings Public Library',
      body: 'A hands-on workshop for all skill levels.',
      meta: { cost: '$5 suggested donation' },
    }));
    expect(isFreeEvent(item, facilities)).toBe(false);
  });

  it('stays true for a library event whose meta.cost explicitly says free', () => {
    const item = storyItem(story({
      venue_raw: 'Brookings Public Library',
      body: 'A hands-on workshop for all skill levels.',
      meta: { cost: 'Free' },
    }));
    expect(isFreeEvent(item, facilities)).toBe(true);
  });
});

describe('eventPriceAgeLine', () => {
  it('is null when meta is absent', () => {
    expect(eventPriceAgeLine(story({ venue_raw: 'Dakota Nature Park' }))).toBeNull();
  });

  it('is null when meta has neither cost nor audience', () => {
    expect(eventPriceAgeLine(story({ meta: { venue: 'Dakota Nature Park' } }))).toBeNull();
  });

  it('renders cost alone', () => {
    expect(eventPriceAgeLine(story({ meta: { cost: 'Free' } }))).toBe('Free');
  });

  it('joins cost and audience when both are present', () => {
    expect(eventPriceAgeLine(story({ meta: { cost: '$10', audience: 'Ages 21+' } }))).toBe('$10 · Ages 21+');
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

describe('isOutdoorEvent', () => {
  const facilities: Facility[] = [
    facility({ slug: 'dykstra-park', name: 'Dykstra Park', category: 'park', aliases: ['dykstra park'] }),
    facility({ slug: 'library', name: 'Brookings Public Library', category: 'library', aliases: ['brookings public library'] }),
  ];

  it('is true when venue resolves to a park', () => {
    expect(isOutdoorEvent(storyItem(story({ venue_raw: 'Dykstra Park' })), facilities)).toBe(true);
  });

  it('is false for a non-park resolved venue', () => {
    expect(isOutdoorEvent(storyItem(story({ venue_raw: 'Brookings Public Library' })), facilities)).toBe(false);
  });

  it('is false for an unresolved venue', () => {
    expect(isOutdoorEvent(storyItem(story({ venue_raw: 'Somewhere Unknown' })), facilities)).toBe(false);
  });

  it('is false for an arts-kind item (never resolves against the town facilities registry)', () => {
    const arts: FeedItem = { sourceKind: 'arts', occurs_at: null, event: artsEvent({}) };
    expect(isOutdoorEvent(arts, facilities)).toBe(false);
  });
});

describe('classifyEventLocality', () => {
  // Real Brookings, SD coordinates/boundary (same data lib/town-boundary.ts
  // ships for brookings_sd) -- City Hall is genuinely inside town limits,
  // Sioux Falls' Washington Pavilion is a real ~50mi-away venue.
  const townId = 'brookings_sd';
  const cityName = 'Brookings';
  const townCenter = { lat: 44.3114, lon: -96.7984 };
  const facilities: Facility[] = [
    facility({ slug: 'city-hall', name: 'Brookings City Hall', category: 'city_hall', aliases: ['brookings city hall'], lat: 44.3105, lon: -96.7978 }),
    facility({ slug: 'washington-pavilion', name: 'Washington Pavilion', category: 'other', aliases: ['washington pavilion'], lat: 43.5460, lon: -96.7313 }),
  ];

  it('is in_town for a resolved venue inside the boundary', () => {
    const item = storyItem(story({ venue_raw: 'Brookings City Hall' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null });
  });

  it('is unknown (excluded) for a resolved venue far outside both the boundary and the 25mi radius', () => {
    const item = storyItem(story({ venue_raw: 'Washington Pavilion' }));
    const result = classifyEventLocality(item, facilities, townId, cityName, townCenter);
    expect(result.zone).toBe('unknown');
    expect(result.distanceMiles).toBeGreaterThan(25);
  });

  it('always treats an arts-kind (SDSU campus) item as in_town, no lookup needed', () => {
    const arts: FeedItem = { sourceKind: 'arts', occurs_at: null, event: artsEvent({}) };
    expect(classifyEventLocality(arts, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null });
  });

  it('treats a virtual venue as in_town rather than nearby/unknown', () => {
    const item = storyItem(story({ venue_raw: 'Zoom Webinar' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null });
  });

  it('falls back to text matching for an unresolved venue naming a different real place', () => {
    const item = storyItem(story({ venue_raw: 'Delta Hotel, 10 E 120th Ave, Northglenn, CO, 80233' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'nearby', distanceMiles: null });
  });

  it('falls back to in_town for an unresolved, bare venue name with no city mentioned', () => {
    const item = storyItem(story({ venue_raw: 'Downtown Main Avenue' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null });
  });

  it('falls back to in_town when the fallback text names the town itself', () => {
    const item = storyItem(story({ venue_raw: 'Grand Lodge, 123 Main St, Brookings, SD' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null });
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
    const item: FeedItem = { sourceKind: 'arts', occurs_at: null, event: artsEvent({ title: 'Family Weekend Concert', teaser: 'Bring the kids for a fun afternoon.' }) };
    expect(isKidsEvent(item)).toBe(true);
  });
});

describe('isCampusEvent', () => {
  it('is true only for arts-kind items', () => {
    const arts: FeedItem = { sourceKind: 'arts', occurs_at: null, event: artsEvent({}) };
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
