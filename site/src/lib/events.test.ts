import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildEventFeed, isToday, isThisWeekend, isTonight, isTomorrow, selectTodayBucket,
  isFreeEvent, isLibraryEvent, isKidsEvent, isCampusEvent, isOutdoorEvent, classifyEventLocality,
  findCrossSourceMatch, eventPriceAgeLine,
  todayUtcMidnight, utcMidnight, localDateParts, artsEventAsStory, dayIndex, weekendAnchorOffset,
  buildWeekendSummary, buildEventSections, eventsAtVenue, selectWeekendNearby,
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

describe('weekendAnchorOffset -- real Fri evening/Sat afternoon/Sun evening/Mon morning, all three site timezones (Phase 2 item 2a verification, 2026-10-08)', () => {
  // Real wall-clock instants for the week of 2026-10-09 (a real Friday) --
  // converted via Python zoneinfo, not hand-computed. System time is mocked
  // (vi.setSystemTime) so todayUtcMidnight() runs for real end-to-end,
  // exactly the real page's own `today = todayUtcMidnight(timezone)` call.
  const scenarios: [string, string, string][] = [
    ['America/Chicago', 'Friday evening', '2026-10-10T00:00:00.000Z'],
    ['America/Chicago', 'Saturday afternoon', '2026-10-10T20:00:00.000Z'],
    ['America/Chicago', 'Sunday evening', '2026-10-12T01:00:00.000Z'],
    ['America/Chicago', 'Monday morning', '2026-10-12T13:00:00.000Z'],
    ['America/Los_Angeles', 'Friday evening', '2026-10-10T02:00:00.000Z'],
    ['America/Los_Angeles', 'Saturday afternoon', '2026-10-10T22:00:00.000Z'],
    ['America/Los_Angeles', 'Sunday evening', '2026-10-12T03:00:00.000Z'],
    ['America/Los_Angeles', 'Monday morning', '2026-10-12T15:00:00.000Z'],
    ['America/Denver', 'Friday evening', '2026-10-10T01:00:00.000Z'],
    ['America/Denver', 'Saturday afternoon', '2026-10-10T21:00:00.000Z'],
    ['America/Denver', 'Sunday evening', '2026-10-12T02:00:00.000Z'],
    ['America/Denver', 'Monday morning', '2026-10-12T14:00:00.000Z'],
  ];

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(scenarios)('%s %s: anchors on the weekend that still has a day left, never one already fully passed', (tz, _label, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const today = todayUtcMidnight(tz);
    const anchor = weekendAnchorOffset(today);
    // The anchor's own weekend block (anchor..anchor+2) must never be
    // entirely in the past relative to "today" -- i.e. Sunday (anchor+2)
    // must be today (0) or later. This is the literal bug: the old formula
    // could return an anchor whose block had already fully elapsed.
    expect(anchor + 2).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['America/Chicago', '2026-10-10T20:00:00.000Z'], // Saturday afternoon
    ['America/Los_Angeles', '2026-10-10T22:00:00.000Z'],
    ['America/Denver', '2026-10-10T21:00:00.000Z'],
  ])('%s Saturday afternoon: tomorrow (Sunday) still counts as this weekend, not Coming up', (tz, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const today = todayUtcMidnight(tz);
    const anchor = weekendAnchorOffset(today);
    // Tomorrow is offset 1 -- must fall inside [anchor, anchor+2], i.e. not
    // get pushed out to the "Coming up" bucket the way the pre-fix formula
    // (anchor = 6, range [6,8]) would have.
    expect(1).toBeGreaterThanOrEqual(anchor);
    expect(1).toBeLessThanOrEqual(anchor + 2);
  });

  it.each([
    ['America/Chicago', '2026-10-12T01:00:00.000Z'], // Sunday evening
    ['America/Los_Angeles', '2026-10-12T03:00:00.000Z'],
    ['America/Denver', '2026-10-12T02:00:00.000Z'],
  ])('%s Sunday evening: rolls forward to NEXT weekend (today itself is excluded, so the hero never renders as three zeros)', (tz, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const today = todayUtcMidnight(tz);
    const anchor = weekendAnchorOffset(today);
    // Today is Sunday (offset 0) -- it must NOT be inside the weekend
    // block (today's own items always go to the "Today" bucket first), and
    // the block must be a real NEXT weekend (starts at least 2 days out).
    expect(0 >= anchor && 0 <= anchor + 2).toBe(false);
    expect(anchor).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['America/Chicago', '2026-10-12T13:00:00.000Z'], // Monday morning
    ['America/Los_Angeles', '2026-10-12T15:00:00.000Z'],
    ['America/Denver', '2026-10-12T14:00:00.000Z'],
  ])('%s Monday morning: shows the upcoming weekend (4 days out), unaffected by the fix', (tz, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const today = todayUtcMidnight(tz);
    expect(weekendAnchorOffset(today)).toBe(4);
  });

  it.each([
    ['America/Chicago', '2026-10-10T00:00:00.000Z'], // Friday evening (today IS Friday)
    ['America/Los_Angeles', '2026-10-10T02:00:00.000Z'],
    ['America/Denver', '2026-10-10T01:00:00.000Z'],
  ])('%s Friday evening: anchors on today (offset 0) -- today\'s own events still route to "Today," not lost', (tz, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const today = todayUtcMidnight(tz);
    expect(weekendAnchorOffset(today)).toBe(0);
  });
});

describe('weekendAnchorOffset -- all seven weekdays (pure calendar math, timezone-independent once `today` is given)', () => {
  it.each([
    [0, 5, 'Sunday rolls forward to next weekend since today is the old weekend\'s last day'], // Sun 2026-10-11
    [1, 4, 'Monday'], // 2026-10-12
    [2, 3, 'Tuesday'], // 2026-10-13
    [3, 2, 'Wednesday'], // 2026-10-14
    [4, 1, 'Thursday'], // 2026-10-15
    [5, 0, 'Friday is today'], // 2026-10-09
    [6, -1, 'Saturday anchors on yesterday\'s Friday so Sunday (+1) still counts'], // 2026-10-10
  ])('weekday %i -> anchor %i (%s)', (_weekday, expectedAnchor, _label) => {
    const dates: Record<number, { y: number; m: number; d: number }> = {
      0: { y: 2026, m: 10, d: 11 }, 1: { y: 2026, m: 10, d: 12 }, 2: { y: 2026, m: 10, d: 13 },
      3: { y: 2026, m: 10, d: 14 }, 4: { y: 2026, m: 10, d: 15 }, 5: { y: 2026, m: 10, d: 9 },
      6: { y: 2026, m: 10, d: 10 },
    };
    const today = utcMidnight(dates[_weekday]);
    expect(today.getUTCDay()).toBe(_weekday);
    expect(weekendAnchorOffset(today)).toBe(expectedAnchor);
  });
});

describe('buildEventSections (owner fix, 2026-10-08: an unknown-locality item must never disappear)', () => {
  const timezone = 'America/Chicago';
  // A real Thursday (2026-10-08) -- anchor offset 1 (tomorrow, Friday,
  // starts the weekend window).
  const today = utcMidnight({ y: 2026, m: 10, d: 8 });

  function atOffsetDays(n: number): string {
    return new Date(today.getTime() + n * 86_400_000 + 18 * 3_600_000).toISOString();
  }

  it('an in_town item inside the weekend window lands in `weekend`', () => {
    const item = storyItem(story({ title: 'In town weekend thing', occurs_at: atOffsetDays(2) })); // Saturday
    const sections = buildEventSections([item], [], today, timezone);
    expect(sections.weekend).toEqual([item]);
    expect(sections.today).toEqual([]);
    expect(sections.nextWeek).toEqual([]);
    expect(sections.later).toEqual([]);
  });

  it('an unknown-locality item at the SAME weekend-window date never lands in `weekend` -- lands in nextWeek instead, but is never dropped', () => {
    const item = storyItem(story({ title: 'Unknown-locality weekend-dated thing', occurs_at: atOffsetDays(2) })); // Saturday
    const sections = buildEventSections([], [item], today, timezone);
    expect(sections.weekend).toEqual([]);
    const allSections = [...sections.today, ...sections.nextWeek, ...sections.later];
    expect(allSections).toContainEqual(item);
    expect(sections.nextWeek).toEqual([item]);
  });

  it('an unknown-locality item dated today lands in `today`, not dropped', () => {
    const item = storyItem(story({ title: 'Unknown today', occurs_at: atOffsetDays(0) }));
    const sections = buildEventSections([], [item], today, timezone);
    expect(sections.today).toEqual([item]);
  });

  it('an unknown-locality item dated far out lands in `later`, not dropped', () => {
    const item = storyItem(story({ title: 'Unknown far out', occurs_at: atOffsetDays(30) }));
    const sections = buildEventSections([], [item], today, timezone);
    expect(sections.later).toEqual([item]);
  });

  it('an undated unknown-locality item lands in `later`, not dropped', () => {
    const item = storyItem(story({ title: 'Undated unknown', occurs_at: null }));
    const sections = buildEventSections([], [item], today, timezone);
    expect(sections.later).toEqual([item]);
  });

  it('mixes in_town and unknown items into the same sections without losing either', () => {
    const inTown = storyItem(story({ title: 'In town today', occurs_at: atOffsetDays(0) }));
    const unknown = storyItem(story({ title: 'Unknown today', occurs_at: atOffsetDays(0) }));
    const sections = buildEventSections([inTown], [unknown], today, timezone);
    expect(sections.today).toEqual(expect.arrayContaining([inTown, unknown]));
    expect(sections.today).toHaveLength(2);
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
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null, method: 'coords' });
  });

  it('is unknown (excluded) for a resolved venue far outside both the boundary and the 25mi radius', () => {
    const item = storyItem(story({ venue_raw: 'Washington Pavilion' }));
    const result = classifyEventLocality(item, facilities, townId, cityName, townCenter);
    expect(result.zone).toBe('unknown');
    expect(result.method).toBe('coords');
    expect(result.distanceMiles).toBeGreaterThan(25);
  });

  it('always treats an arts-kind (SDSU campus) item as in_town, no lookup needed', () => {
    const arts: FeedItem = { sourceKind: 'arts', occurs_at: null, event: artsEvent({}) };
    expect(classifyEventLocality(arts, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null, method: 'default' });
  });

  it('treats a virtual venue as in_town rather than nearby/unknown', () => {
    const item = storyItem(story({ venue_raw: 'Zoom Webinar' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null, method: 'default' });
  });

  // Owner correction, 2026-10-08: an unresolved venue naming a different
  // real place used to come back 'nearby' with no distance -- unverifiable,
  // since NEARBY_RADIUS_MILES can't be checked without a real coordinate.
  // Now 'unknown' (excluded) instead -- see classifyLocalityByText()'s own
  // doc comment in lib/town-boundary.ts. A venue worth actually surfacing
  // as Nearby needs a real `places` row with real coordinates.
  it('falls back to text matching, but never confidently "nearby," for an unresolved venue naming a different real place', () => {
    const item = storyItem(story({ venue_raw: 'Delta Hotel, 10 E 120th Ave, Northglenn, CO, 80233' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'unknown', distanceMiles: null, method: 'text' });
  });

  it('falls back to in_town for an unresolved, bare venue name with no city mentioned', () => {
    const item = storyItem(story({ venue_raw: 'Downtown Main Avenue' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null, method: 'text' });
  });

  it('falls back to in_town when the fallback text names the town itself', () => {
    const item = storyItem(story({ venue_raw: 'Grand Lodge, 123 Main St, Brookings, SD' }));
    expect(classifyEventLocality(item, facilities, townId, cityName, townCenter)).toEqual({ zone: 'in_town', distanceMiles: null, method: 'text' });
  });
});

describe('eventsAtVenue (Phase 3, "Event <-> facility hub")', () => {
  const facilities: Facility[] = [
    facility({ slug: 'library', name: 'Brookings Public Library', category: 'library', aliases: ['brookings public library'] }),
  ];

  it('returns other stories resolving to the same venue, excluding the current one', () => {
    const current = story({ slug: 'story-tape', title: 'Current', venue_raw: 'Brookings Public Library' });
    const other = story({ slug: 'story-b', title: 'Other Thing', venue_raw: 'Brookings Public Library' });
    const elsewhere = story({ slug: 'story-c', title: 'Elsewhere', venue_raw: 'Some Other Place' });
    const result = eventsAtVenue([current, other, elsewhere], facilities, 'library', current.slug);
    expect(result.map((s) => s.slug)).toEqual(['story-b']);
  });

  it('caps to `limit`', () => {
    const stories = Array.from({ length: 10 }, (_, i) =>
      story({ slug: `s-${i}`, venue_raw: 'Brookings Public Library' }));
    expect(eventsAtVenue(stories, facilities, 'library', undefined, 3)).toHaveLength(3);
  });

  it('returns empty when the venue never resolves (no venue name at all, common for Brookings)', () => {
    const noVenue = story({ slug: 's1', venue_raw: null });
    expect(eventsAtVenue([noVenue], facilities, 'library')).toEqual([]);
  });
});

describe('selectWeekendNearby (Phase 3, "Event <-> facility hub")', () => {
  const townId = 'brookings_sd';
  const cityName = 'Brookings';
  const timezone = 'America/Chicago';
  const townCenter = { lat: 44.3114, lon: -96.7984 };
  const facilities: Facility[] = [
    facility({ slug: 'city-hall', name: 'Brookings City Hall', category: 'city_hall', aliases: ['brookings city hall'], lat: 44.3105, lon: -96.7978 }),
    // A real resolved venue ~6mi outside the Brookings boundary but well
    // within the 25mi nearby radius -- 'nearby' can only come from the
    // coordinate path now (classifyLocalityByText() no longer returns
    // 'nearby' for an unresolved address string, see town-boundary.ts's
    // own doc comment on that owner-requested safety fix).
    facility({ slug: 'nearby-hall', name: 'Nearby Hall', category: 'other', aliases: ['nearby hall'], lat: 44.3114, lon: -96.65 }),
  ];
  const today = utcMidnight({ y: 2026, m: 10, d: 8 }); // Thursday, anchor offset 1
  function atOffsetDays(n: number): string {
    return new Date(today.getTime() + n * 86_400_000 + 18 * 3_600_000).toISOString();
  }

  it('excludes the current story itself', () => {
    const current = storyItem(story({ slug: 'self', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) }));
    const items = [current];
    const result = selectWeekendNearby(items, facilities, townId, cityName, townCenter, timezone, 'self');
    expect(result).toEqual([]);
  });

  it('sorts in-town results before nearby ones', () => {
    const inTownItem = storyItem(story({ slug: 'in-town', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) }));
    const nearbyItem = storyItem(story({ slug: 'nearby-one', venue_raw: 'Nearby Hall', occurs_at: atOffsetDays(1) }));
    const result = selectWeekendNearby([nearbyItem, inTownItem], facilities, townId, cityName, townCenter, timezone, 'excluded-self');
    expect(result.map((r) => r.zone)).toEqual(['in_town', 'nearby']);
  });

  it('excludes items outside the weekend window', () => {
    const farOut = storyItem(story({ slug: 'far', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(10) }));
    const result = selectWeekendNearby([farOut], facilities, townId, cityName, townCenter, timezone, 'excluded-self');
    expect(result).toEqual([]);
  });

  it('excludes unknown-locality items (unlike the main /events/ sections, this is a curated rail, not a complete list)', () => {
    const unknown = storyItem(story({
      slug: 'unknown', venue_raw: 'Some Hall, 1 Main St, Far Away City, ZZ 00000', occurs_at: atOffsetDays(2),
    }));
    const result = selectWeekendNearby([unknown], facilities, townId, cityName, townCenter, timezone, 'excluded-self');
    expect(result).toEqual([]);
  });

  it('caps to `limit`', () => {
    const items: FeedItem[] = Array.from({ length: 8 }, (_, i) =>
      storyItem(story({ slug: `w-${i}`, venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) })));
    expect(selectWeekendNearby(items, facilities, townId, cityName, townCenter, timezone, 'excluded-self', 3)).toHaveLength(3);
  });
});

describe('buildWeekendSummary (Phase 2, item 2b -- homepage module)', () => {
  const townId = 'brookings_sd';
  const cityName = 'Brookings';
  const timezone = 'America/Chicago';
  const townCenter = { lat: 44.3114, lon: -96.7984 };
  const facilities: Facility[] = [
    facility({ slug: 'city-hall', name: 'Brookings City Hall', category: 'city_hall', aliases: ['brookings city hall'], lat: 44.3105, lon: -96.7978 }),
  ];
  // A real Thursday (2026-10-08) -- anchor offset 1, i.e. tomorrow (Friday)
  // is the start of the weekend. buildWeekendSummary() calls
  // todayUtcMidnight() internally (reads the real clock), so system time is
  // mocked to noon America/Chicago on that same date -- not re-derived,
  // just pinned to match the `today` used for atOffsetDays() below.
  const today = utcMidnight({ y: 2026, m: 10, d: 8 });
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T17:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  function atOffsetDays(n: number): string {
    return new Date(today.getTime() + n * 86_400_000 + 18 * 3_600_000).toISOString(); // mid-afternoon-ish local
  }

  it('is null when there is nothing this weekend', () => {
    expect(buildWeekendSummary([], facilities, townId, cityName, townCenter, timezone)).toBeNull();
  });

  it('counts Friday/Saturday/Sunday separately and returns the matching items', () => {
    const items: FeedItem[] = [
      storyItem(story({ title: 'Fri Thing', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(1) })),
      storyItem(story({ title: 'Sat Thing A', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) })),
      storyItem(story({ title: 'Sat Thing B', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) })),
      storyItem(story({ title: 'Sun Thing', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(3) })),
    ];
    const summary = buildWeekendSummary(items, facilities, townId, cityName, townCenter, timezone);
    expect(summary?.counts).toEqual({ friday: 1, saturday: 2, sunday: 1 });
    expect(summary?.items.map((i) => i.sourceKind === 'story' && i.story.title)).toEqual(
      ['Fri Thing', 'Sat Thing A', 'Sat Thing B', 'Sun Thing'],
    );
  });

  it('caps the returned items to `limit` but still reports the real total counts', () => {
    const items: FeedItem[] = Array.from({ length: 6 }, (_, i) =>
      storyItem(story({ title: `Sat ${i}`, venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(2) })));
    const summary = buildWeekendSummary(items, facilities, townId, cityName, townCenter, timezone, 3);
    expect(summary?.counts.saturday).toBe(6);
    expect(summary?.items).toHaveLength(3);
  });

  it('excludes events outside the weekend window and non-in_town events', () => {
    const items: FeedItem[] = [
      storyItem(story({ title: 'Next week', venue_raw: 'Brookings City Hall', occurs_at: atOffsetDays(10) })),
      // Unresolved, address-shaped venue naming a different real place --
      // classifies 'unknown' (see town-boundary.ts), never counted here.
      storyItem(story({ title: 'Far away', venue_raw: 'Some Hall, 1 Main St, Elsewhere, ZZ, 00000', occurs_at: atOffsetDays(2) })),
    ];
    expect(buildWeekendSummary(items, facilities, townId, cityName, townCenter, timezone)).toBeNull();
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
