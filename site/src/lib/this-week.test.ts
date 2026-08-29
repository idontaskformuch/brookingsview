import { describe, expect, it } from 'vitest';
import {
  weekInfoForInstant, weekInfoForSlug, currentWeekInfo, isoWeekInfo,
  formatWeekLabel, buildWeekDays, selectWeeklyLead, weekDays, addDays,
} from './this-week';
import type { Story, RegionalGame, SdsuEvent, ProjectUpdate } from './db';

const CHICAGO = 'America/Chicago';
const LOS_ANGELES = 'America/Los_Angeles';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'meeting',
    source_url: null, occurs_at: null, published_at: '2026-08-23T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null,
    ...overrides,
  };
}

describe('isoWeekInfo', () => {
  it('matches a known ISO week (2026-08-24 is a Monday, week 35)', () => {
    expect(isoWeekInfo({ y: 2026, m: 8, d: 24 })).toEqual({ isoYear: 2026, isoWeek: 35 });
  });

  it('a late-December Monday can belong to ISO week 1 of the following year', () => {
    // 2025-12-29 is a Monday; ISO week 1 of 2026 starts there.
    expect(isoWeekInfo({ y: 2025, m: 12, d: 29 })).toEqual({ isoYear: 2026, isoWeek: 1 });
  });
});

describe('formatWeekLabel', () => {
  it('same month', () => {
    expect(formatWeekLabel({ y: 2026, m: 8, d: 24 }, { y: 2026, m: 8, d: 30 })).toBe('August 24–30, 2026');
  });
  it('crosses a month boundary', () => {
    expect(formatWeekLabel({ y: 2026, m: 7, d: 28 }, { y: 2026, m: 8, d: 3 })).toBe('July 28–August 3, 2026');
  });
  it('crosses a year boundary', () => {
    expect(formatWeekLabel({ y: 2025, m: 12, d: 29 }, { y: 2026, m: 1, d: 4 }))
      .toBe('December 29, 2025 – January 4, 2026');
  });
});

describe('weekInfoForInstant', () => {
  it('places a mid-week instant onto that week\'s Monday, in the town\'s own timezone', () => {
    // A Thursday afternoon UTC that is still Wednesday night in Chicago is
    // NOT the bug this guards -- pick an unambiguous Thursday local time.
    const info = weekInfoForInstant(new Date('2026-08-27T18:00:00Z'), CHICAGO);
    expect(info.monday).toEqual({ y: 2026, m: 8, d: 24 });
    expect(info.sunday).toEqual({ y: 2026, m: 8, d: 30 });
    expect(info.slug).toBe('2026-w35');
    expect(info.label).toBe('August 24–30, 2026');
  });

  it('an instant just after UTC midnight that is still the previous local day in LA lands on the correct week', () => {
    // 2026-08-25T04:00:00Z is 2026-08-24 21:00 in Los_Angeles (still Monday).
    const info = weekInfoForInstant(new Date('2026-08-25T04:00:00Z'), LOS_ANGELES);
    expect(info.monday).toEqual({ y: 2026, m: 8, d: 24 });
  });

  it('start/end bracket real timestamps for the whole local week and nothing else', () => {
    const info = weekInfoForInstant(new Date('2026-08-27T18:00:00Z'), CHICAGO);
    // Monday 00:00 America/Chicago (CDT, UTC-5) is 05:00 UTC.
    expect(info.start.toISOString()).toBe('2026-08-24T05:00:00.000Z');
    expect(info.end.toISOString()).toBe('2026-08-31T05:00:00.000Z');
  });

  it('civilStart/civilEnd are bare UTC-midnight calendar dates, independent of timezone', () => {
    const info = weekInfoForInstant(new Date('2026-08-27T18:00:00Z'), CHICAGO);
    expect(info.civilStart.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    expect(info.civilEnd.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('weekInfoForSlug', () => {
  it('round-trips with weekInfoForInstant', () => {
    const forward = weekInfoForInstant(new Date('2026-08-27T18:00:00Z'), CHICAGO);
    const back = weekInfoForSlug('2026-w35', CHICAGO);
    expect(back).not.toBeNull();
    expect(back!.monday).toEqual(forward.monday);
    expect(back!.start.toISOString()).toBe(forward.start.toISOString());
  });

  it('rejects a malformed slug', () => {
    expect(weekInfoForSlug('not-a-week', CHICAGO)).toBeNull();
    expect(weekInfoForSlug('2026-35', CHICAGO)).toBeNull();
  });
});

describe('currentWeekInfo', () => {
  it('returns a well-formed slug for right now', () => {
    expect(currentWeekInfo(CHICAGO).slug).toMatch(/^\d{4}-w\d{2}$/);
  });
});

describe('weekDays / addDays', () => {
  it('produces exactly 7 consecutive calendar days starting Monday', () => {
    const info = weekInfoForSlug('2026-w35', CHICAGO)!;
    const days = weekDays(info);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ y: 2026, m: 8, d: 24 });
    expect(days[6]).toEqual({ y: 2026, m: 8, d: 30 });
  });

  it('addDays rolls over a month boundary', () => {
    expect(addDays({ y: 2026, m: 8, d: 30 }, 3)).toEqual({ y: 2026, m: 9, d: 2 });
  });
});

const WEEK = weekInfoForSlug('2026-w35', CHICAGO)!; // Mon 2026-08-24 .. Sun 2026-08-30

describe('buildWeekDays', () => {
  it('buckets a real-timestamp event onto its LOCAL calendar day (America/Chicago)', () => {
    // 2026-08-26T04:30:00Z is 2026-08-25 23:30 CDT -- still Tuesday locally.
    const eventStories: Story[] = [story({
      slug: 'downtown-sundown', source_type: 'event', occurs_at: '2026-08-26T04:30:00Z',
      title: 'Downtown at Sundown',
    })];
    const days = buildWeekDays(WEEK, CHICAGO, {
      eventStories, meetingStories: [], artsEvents: [], projectUpdates: [], games: [], regionalGames: [],
    });
    const tuesday = days[1];
    const wednesday = days[2];
    expect(tuesday.items.map((i) => i.title)).toContain('Downtown at Sundown');
    expect(wednesday.items.map((i) => i.title)).not.toContain('Downtown at Sundown');
  });

  it('buckets a meeting by its BARE UTC calendar date, never re-interpreted through a timezone', () => {
    // meeting_date stored as UTC midnight for 2026-08-26 -- must land on
    // Wednesday (2026-08-26) even though America/Chicago would read this
    // exact instant as 2026-08-25 19:00 local (the historical bug).
    const meetingStories: Story[] = [story({
      slug: 'council-meeting', source_type: 'meeting', occurs_at: '2026-08-26T00:00:00Z',
      title: 'City Council',
    })];
    const days = buildWeekDays(WEEK, CHICAGO, {
      eventStories: [], meetingStories, artsEvents: [], projectUpdates: [], games: [], regionalGames: [],
    });
    const tuesday = days[1];
    const wednesday = days[2];
    expect(wednesday.items.map((i) => i.title)).toContain('City Council');
    expect(tuesday.items.map((i) => i.title)).not.toContain('City Council');
  });

  it('buckets a project update by its bare meeting_date the same way', () => {
    const projectUpdates: (ProjectUpdate & { project_slug: string; project_title: string })[] = [{
      source_type: 'meeting', entry_date: '2026-08-26T00:00:00Z',
      body: 'Approved on first reading.', meeting_date: '2026-08-26T00:00:00Z',
      agenda_counter: '1', agenda_title: 'Zoning amendment', agenda_url: null, outcome: 'approved',
      vote_yes: 5, vote_no: 0, vote_abstain: 0, vote_absent: 0, source_url: null, synthesis: null,
      project_slug: 'sixth-street-corridor', project_title: '6th Street Corridor',
    }];
    const days = buildWeekDays(WEEK, CHICAGO, {
      eventStories: [], meetingStories: [], artsEvents: [], projectUpdates, games: [], regionalGames: [],
    });
    expect(days[2].items[0].href).toBe('/city-hall/projects/sixth-street-corridor/');
  });

  it('regional (MoVal) games use game_date, not game_time_utc, for bucketing', () => {
    const regionalGames: RegionalGame[] = [{
      league: 'MiLB', team_name: 'Inland Empire 66ers', team_abbr: '66ers',
      opponent_name: 'Lake Elsinore Storm', home_away: 'home',
      game_date: '2026-08-28T00:00:00Z', game_time_utc: '2026-08-29T02:05:00Z',
      status: 'scheduled', team_score: null, opponent_score: null,
      venue: 'San Manuel Stadium', relevance_tier: 'primary',
    }];
    const days = buildWeekDays(WEEK, LOS_ANGELES, {
      eventStories: [], meetingStories: [], artsEvents: [], projectUpdates: [], games: [], regionalGames,
    });
    // 2026-08-28 is a Friday -- index 4.
    expect(days[4].items.map((i) => i.title)).toContain('Inland Empire 66ers vs Lake Elsinore Storm');
    expect(days[4].items[0].href).toBe('/sports/');
  });

  it('a quiet day with real data elsewhere in the week gets no items, never a fabricated one', () => {
    const eventStories: Story[] = [story({
      slug: 'only-event', source_type: 'event', occurs_at: '2026-08-24T18:00:00Z', title: 'Monday Only',
    })];
    const days = buildWeekDays(WEEK, CHICAGO, {
      eventStories, meetingStories: [], artsEvents: [], projectUpdates: [], games: [], regionalGames: [],
    });
    expect(days[0].items).toHaveLength(1);
    for (const quiet of days.slice(1)) expect(quiet.items).toHaveLength(0);
  });

  it('dedups an event cross-listed by both a story source and SDSU (same date+title), matching /events', () => {
    const eventStories: Story[] = [story({
      slug: 'downtown-sundown', source_type: 'event', occurs_at: '2026-08-27T00:00:00Z',
      title: 'Downtown at Sundown',
    })];
    const artsEvents: SdsuEvent[] = [{
      external_event_id: 'sdsu-1', title: 'Downtown at Sundown', teaser: null, location: null,
      starts_at: '2026-08-27T00:00:00Z', ends_at: null, categories: [], primary_category: null,
      event_url: 'https://sdstate.edu/event/1',
    }];
    const days = buildWeekDays(WEEK, CHICAGO, {
      eventStories, meetingStories: [], artsEvents, projectUpdates: [], games: [], regionalGames: [],
    });
    const allTitles = days.flatMap((d) => d.items.map((i) => i.title));
    expect(allTitles.filter((t) => t === 'Downtown at Sundown')).toHaveLength(1);
  });
});

describe('selectWeeklyLead', () => {
  it('picks the sole candidate', () => {
    const candidate = story({ slug: 'rezoning-vote', title: 'Council approves rezoning' });
    expect(selectWeeklyLead([candidate])?.slug).toBe('rezoning-vote');
  });

  it('a quiet week (no candidates) returns null rather than forcing a pick', () => {
    expect(selectWeeklyLead([])).toBeNull();
  });

  it('picks the first candidate in the given (already featured-first, DB-ordered) list', () => {
    // getWorthKnowingCandidatesInRange orders featured DESC before calling
    // this -- selectWeeklyLead trusts that ordering rather than re-sorting.
    const featured = story({ slug: 'big-vote', featured: true, occurs_at: '2026-08-26T00:00:00Z' });
    const ordinary = story({ slug: 'routine-minutes', occurs_at: '2026-08-25T00:00:00Z' });
    expect(selectWeeklyLead([featured, ordinary])?.slug).toBe('big-vote');
  });
});
