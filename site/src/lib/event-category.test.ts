import { describe, expect, it } from 'vitest';
import { categorize, categoryOfEvent } from './event-category';
import { makeRowFacts } from './event-row-facts';
import { buildWeekDays, weekInfoForInstant } from './this-week';
import { themeOf, weekDayBlocks } from './week-groups';
import type { FeedItem } from './events';
import type { Story } from './db';

describe('categoryOfEvent', () => {
  it.each([
    ['SDSU Concert Choir Fall Concert', 'music'], ['Library Commission Meeting', 'civic'], ['Toddler Storytime', 'family'],
    ['Farmers Market', 'food'], ['Open Mic Night', 'nightlife'], ['Pottery workshop', 'arts'], ['Jackrabbits vs Bison', 'sports'],
  ])('%s -> %s', (title, cat) => expect(categoryOfEvent(title)).toBe(cat));
  it('no match is null, never a guess', () => {
    expect(categoryOfEvent('Mrs. Doubtfire Outdoor Screening')).toBe('arts');
    expect(categoryOfEvent('Shop for a Cause Fundraiser')).toBeNull();
    expect(categoryOfEvent('Veterans Day')).toBeNull();
  });
  it('uses the source category label when it has one', () => {
    expect(categoryOfEvent('Evening at the hall', 'Music')).toBe('music');
  });
});

describe('categoryOfEvent: "board" and plurals (owner 2026-11-08)', () => {
  it('"board" alone is not civic; a board meeting is', () => {
    expect(categoryOfEvent('Board Games More Games')).toBeNull();
    expect(categoryOfEvent('School Board Meeting')).toBe('civic');
    expect(categoryOfEvent('Board of Supervisors')).toBe('civic');
  });
  it('plurals match like the singular', () => {
    expect(categoryOfEvent('Playwriting workshops with John Binnie')).toBe('arts');
    expect(categoryOfEvent('Summer concerts')).toBe('music');
    expect(categoryOfEvent('Open galleries weekend')).toBe('arts');
  });
  it('tabletop "games" stay neutral', () => {
    expect(categoryOfEvent('Table Top Role Playing Games Club')).toBeNull();
  });
  it('the 26 live Glasgow titles (2026-11-08): neutral 15 of 26 before (58 %), 11 after (42 %): Board Games civic -> neutral, 5 museum/workshop rows -> arts via the plural', async () => {
    const rows = (await import('./fixtures/glasgow-event-titles-2026-11-08.json')).default as Array<{ title: string; category: string | null }>;
    expect(rows).toHaveLength(26);
    const neutral = rows.filter((r) => categoryOfEvent(r.title, r.category) === null).length;
    expect(neutral).toBe(11);
    expect(categoryOfEvent(rows.find((r) => r.title.startsWith('Board Games'))!.title)).toBeNull();
  });
});

describe('one category function for every page (owner 2026-11-26 (8))', () => {
  // The real row: stories id 4306, slug event-333844 (Glasgow Life), as read 2026-11-26: title, venue_raw, meta.category ordagrant.
  const riverside = {
    id: 4306, slug: 'event-333844', title: 'Riverside Christmas Market', venue_raw: 'Riverside Museum', source_type: 'event',
    source_url: 'https://www.glasgowlife.org.uk/event/4/riverside-christmas-market', occurs_at: '2026-11-28T00:00:00+00:00',
    published_at: '2026-11-20T00:00:00+00:00', body: '', meta: { category: 'Museums & exhibitions' },
  } as unknown as Story;
  const TZ = 'Europe/London';

  it('the order: the source label, then the title, the venue last', () => {
    expect(categorize({ source: ['Museums & exhibitions'], title: 'Riverside Christmas Market', venue: 'Riverside Museum' })).toBe('arts');
    expect(categorize({ title: 'Riverside Christmas Market', venue: 'Riverside Museum' })).toBe('food'); // no label: the title
    expect(categorize({ title: 'Discover! Weekend Sessions', venue: 'Riverside Museum' })).toBe('arts'); // nothing else: the venue
    expect(categorize({ source: ['Undefined', 'Miscellaneous'], title: 'Holiday Lights' })).toBeNull();
    expect(categorize({ source: ['Music', 'Dance/Electronic'], title: 'Fat Dog' })).toBe('music'); // Ticketmaster: segment, then genre ("dance" alone would read as arts)
  });

  it('Riverside Christmas Market is Arts on /events/, on /this-week/ (row and theme) alike; it was Food on /events/', () => {
    const feed: FeedItem = { sourceKind: 'story', occurs_at: riverside.occurs_at, story: riverside };
    expect(makeRowFacts({ cityName: 'Glasgow', facilities: [], areas: null })(feed).cat).toBe('arts');

    const week = weekInfoForInstant(new Date('2026-11-26T12:00:00Z'), TZ);
    const days = buildWeekDays(week, TZ, { eventStories: [riverside], meetingStories: [], artsEvents: [], projectUpdates: [], games: [], regionalGames: [], meetingsHaveTime: true });
    const sat = days.find((d) => d.items.length > 0)!;
    expect(sat.items[0].categories).toEqual(['Museums & exhibitions']);
    const blocks = weekDayBlocks(days, days, TZ, (k) => k, 'Glasgow');
    expect(blocks.days[0].rows[0]).toMatchObject({ title: 'Riverside Christmas Market', category: 'arts' });
    expect(themeOf({ ...sat.items[0] })).toBe('arts');
  });
});
