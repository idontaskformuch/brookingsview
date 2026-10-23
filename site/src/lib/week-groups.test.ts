import { describe, expect, it } from 'vitest';
import { formatWhen, groupWeekItems, shortVenue, themeOf } from './week-groups';
import type { DayBucket, DayItem } from './this-week';

const TZ = 'America/Chicago';
const item = (o: Partial<DayItem> & { title: string }): DayItem => ({
  vertical: 'events', href: `/s/${o.title}/`, external: false, detail: '', ...o,
});
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const day = (items: DayItem[], i: number): DayBucket => ({
  date: { y: 2026, m: 10, d: 19 + i }, weekdayName: NAMES[i], leadVertical: 'events', items,
});

describe('themeOf', () => {
  it('uses the vertical for city meetings and sports', () => {
    expect(themeOf({ vertical: 'city_hall', title: 'City Council' })).toBe('city');
    expect(themeOf({ vertical: 'sports', title: 'wbb vs USD' })).toBe('sports');
  });
  it('places events by keyword, first rule wins', () => {
    expect(themeOf({ vertical: 'sdsu', title: 'Fall Choir Concert' })).toBe('music');
    expect(themeOf({ vertical: 'events', title: 'Bloom and Grow: Spooky Plants', venue: 'McCrory Gardens' })).toBe('arts');
    expect(themeOf({ vertical: 'events', title: 'Board Games', venue: 'Brookings Public Library' })).toBe('library');
    expect(themeOf({ vertical: 'events', title: 'Kids Chess Club' })).toBe('family');
    expect(themeOf({ vertical: 'events', title: 'Pancake Breakfast' })).toBe('food');
    expect(themeOf({ vertical: 'events', title: 'Jacks Club Hockey vs Crookston' })).toBe('sports');
  });
  it('falls back to Campus for SDSU items and Around town for the rest', () => {
    expect(themeOf({ vertical: 'sdsu', title: 'Honors Visit Day' })).toBe('campus');
    expect(themeOf({ vertical: 'events', title: 'Hobo Day' })).toBe('community');
  });
});

describe('formatWhen', () => {
  it('shows day and compact time', () => {
    // 2026-10-23 19:00 Chicago (CDT) = 00:00Z next day
    expect(formatWhen(4, { startsAt: '2026-10-24T00:00:00Z' }, TZ)).toBe('Fri 7pm');
    expect(formatWhen(4, { startsAt: '2026-10-24T00:30:00Z' }, TZ)).toBe('Fri 7:30pm');
  });
  it('shows "all day" for a local-midnight start with no end, and just the day when there is no time', () => {
    expect(formatWhen(5, { startsAt: '2026-10-24T05:00:00Z' }, TZ)).toBe('Sat all day');
    expect(formatWhen(1, { startsAt: null }, TZ)).toBe('Tue');
  });
  it('treats a local-midnight start with a later local-midnight end as all day, but keeps a real clock end', () => {
    expect(formatWhen(5, { startsAt: '2026-10-24T05:00:00Z', endsAt: '2026-10-25T05:00:00Z' }, TZ)).toBe('Sat all day');
    expect(formatWhen(5, { startsAt: '2026-10-24T05:00:00Z', endsAt: '2026-10-24T20:00:00Z' }, TZ)).toBe('Sat 12am');
  });
});

describe('groupWeekItems', () => {
  const all = [
    day([], 0),
    day([item({ vertical: 'city_hall', title: 'City Council Regular Meeting', startsAt: null })], 1),
    day([item({ title: 'Fall Choir Concert', vertical: 'sdsu', startsAt: '2026-10-22T00:30:00Z' })], 2),
    day([], 3),
    day([
      item({ vertical: 'sports', title: 'volleyball vs USD', startsAt: '2026-10-24T00:00:00Z', venue: 'First Bank & Trust Arena' }),
      item({ title: 'Hobo Day', startsAt: '2026-10-24T05:00:00Z' }),
    ], 4),
    day([], 5),
    day([], 6),
  ];
  it('orders groups, omits empty ones and sorts rows by day then time', () => {
    const groups = groupWeekItems(all, all, TZ);
    expect(groups.map((g) => g.id)).toEqual(['city', 'music', 'sports', 'community']);
    const sports = groups.find((g) => g.id === 'sports')!;
    expect(sports.rows[0]).toMatchObject({ when: 'Fri 7pm', title: 'volleyball vs USD', venue: 'First Bank & Trust Arena' });
    expect(groups.find((g) => g.id === 'city')!.rows[0].when).toBe('Tue');
  });
  it('leaves out days that were not passed (past days of the current week)', () => {
    const groups = groupWeekItems(all.slice(3), all, TZ);
    expect(groups.map((g) => g.id)).toEqual(['sports', 'community']);
  });
});

describe('shortVenue', () => {
  it('uses the parenthetical name, or the text before the first comma', () => {
    expect(shortVenue('Brookings, S.D. (Dana J. Dykhouse Stadium)')).toBe('Dana J. Dykhouse Stadium');
    expect(shortVenue('Larson Ice Center, 924 32nd Ave, Brookings, SD, 57006, United States')).toBe('Larson Ice Center');
    expect(shortVenue('1229 Western Ave, 1229 Western Ave, Brookings, SD')).toBe('1229 Western Ave');
    expect(shortVenue(null)).toBeNull();
    expect(shortVenue('')).toBeNull();
  });
});

describe('duplicates across sources', () => {
  const all = [
    day([], 0), day([], 1), day([], 2), day([], 3), day([], 4),
    day([
      item({ vertical: 'sports', title: 'football vs Murray State', href: '/jackrabbits/', startsAt: '2026-10-24T19:00:00Z' }),
      item({ title: 'SDSU Football vs Murray State', href: '/s/football-murray/', startsAt: '2026-10-24T19:00:00Z', venue: 'Dana J. Dykhouse Stadium, 1396 Stadium Rd' }),
    ], 5),
    day([], 6),
  ];
  it('shows one row for the same game listed by two sources, preferring our own page and keeping the venue', () => {
    const sports = groupWeekItems(all, all, TZ).find((g) => g.id === 'sports')!;
    expect(sports.rows).toHaveLength(1);
    expect(sports.rows[0]).toMatchObject({ when: 'Sat 2pm', href: '/s/football-murray/', venue: 'Dana J. Dykhouse Stadium' });
  });
});

describe('food beats family for a family breakfast', () => {
  it('puts "American Legion Family Breakfast" under food', () => {
    expect(themeOf({ vertical: 'events', title: 'American Legion Family Breakfast' })).toBe('food');
    expect(themeOf({ vertical: 'events', title: 'Kids Chess Club' })).toBe('family');
  });
});
