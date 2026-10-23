import { describe, expect, it } from 'vitest';
import {
  formatDays, formatWhen, groupWeekItems, isQuorumNotice, normalizeSportTitle, shortVenue, themeOf, titleIncludes,
} from './week-groups';
import type { DayBucket, DayItem } from './this-week';

const TZ = 'America/Chicago';
const item = (o: Partial<DayItem> & { title: string }): DayItem => ({
  vertical: 'events', href: `/s/${o.title}/`, external: false, detail: '', ...o,
});
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const day = (items: DayItem[], i: number): DayBucket => ({
  date: { y: 2026, m: 10, d: 19 + i }, weekdayName: NAMES[i], leadVertical: 'events', items,
});
/** A Monday-to-Sunday week from a sparse {dayIndex: items} map. */
const week = (byDay: Record<number, DayItem[]>): DayBucket[] => NAMES.map((_, i) => day(byDay[i] ?? [], i));

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
  it('puts a family breakfast under food, a kids club under family', () => {
    expect(themeOf({ vertical: 'events', title: 'American Legion Family Breakfast' })).toBe('food');
    expect(themeOf({ vertical: 'events', title: 'Kids Chess Club' })).toBe('family');
  });
});

describe('formatWhen and formatDays', () => {
  it('shows day and compact time', () => {
    // 2026-10-23 19:00 Chicago (CDT) = 00:00Z next day
    expect(formatWhen(4, { startsAt: '2026-10-24T00:00:00Z' }, TZ)).toBe('Fri 7pm');
    expect(formatWhen(4, { startsAt: '2026-10-24T00:30:00Z' }, TZ)).toBe('Fri 7:30pm');
  });
  it('shows "all day" for a local-midnight start with no end, and just the day when there is no time', () => {
    expect(formatWhen(5, { startsAt: '2026-10-24T05:00:00Z' }, TZ)).toBe('Sat all day');
    expect(formatWhen(1, { startsAt: null }, TZ)).toBe('Tue');
    expect(formatWhen(5, { startsAt: '2026-10-24T05:00:00Z', endsAt: '2026-10-25T05:00:00Z' }, TZ)).toBe('Sat all day');
  });
  it('writes consecutive days as an en-dash interval and others as a list', () => {
    expect(formatDays([0, 1, 2, 3, 4])).toBe('Mon–Fri');
    expect(formatDays([4, 5])).toBe('Fri–Sat');
    expect(formatDays([0, 2, 4])).toBe('Mon, Wed, Fri');
    expect(formatDays([5])).toBe('Sat');
  });
});

describe('helpers', () => {
  it('shortVenue uses the parenthetical name, or the text before the first comma', () => {
    expect(shortVenue('Brookings, S.D. (Dana J. Dykhouse Stadium)')).toBe('Dana J. Dykhouse Stadium');
    expect(shortVenue('Larson Ice Center, 924 32nd Ave, Brookings, SD, 57006, United States')).toBe('Larson Ice Center');
    expect(shortVenue('1229 Western Ave, 1229 Western Ave, Brookings, SD')).toBe('1229 Western Ave');
    expect(shortVenue(null)).toBeNull();
    expect(shortVenue('')).toBeNull();
  });
  it('normalizeSportTitle capitalizes, drops a leading SDSU, and expands basketball codes', () => {
    expect(normalizeSportTitle('volleyball vs South Dakota')).toBe('Volleyball vs South Dakota');
    expect(normalizeSportTitle('SDSU Football vs Murray State')).toBe('Football vs Murray State');
    expect(normalizeSportTitle('wbb vs St. Thomas')).toBe("Women's basketball vs St. Thomas");
    // SDSU athletics feed abbreviations (2026-10-23: CityStatus showed "VB vs USD")
    expect(normalizeSportTitle('VB vs USD')).toBe('Volleyball vs South Dakota');
    expect(normalizeSportTitle('WBB vs  UNI')).toBe("Women's basketball vs Northern Iowa");
    expect(normalizeSportTitle('MBB vs Valpo')).toBe("Men's basketball vs Valpo");
    expect(normalizeSportTitle('SDSU VB vs Nebraska')).toBe('Volleyball vs Nebraska');
    expect(normalizeSportTitle('Soccer Vs Washington State')).toBe('Soccer vs Washington State');
    expect(normalizeSportTitle('Soccer vs NDSU')).toBe('Soccer vs North Dakota State');
    expect(normalizeSportTitle('VB vs Omaha, TBD')).toBe('Volleyball vs Omaha, TBD');
    expect(normalizeSportTitle('SDSU vs Bradley')).toBe('SDSU vs Bradley');
    expect(normalizeSportTitle('Jack 15 Road Race')).toBe('Jack 15 Road Race');
    expect(normalizeSportTitle('Football at USD')).toBe('Football at South Dakota');
    expect(normalizeSportTitle('mbb at Omaha')).toBe("Men's basketball at Omaha");
    expect(normalizeSportTitle('Jacks Club Hockey vs Crookston')).toBe('Jacks Club Hockey vs Crookston');
  });
  it('isQuorumNotice matches the Legistar quorum notices only', () => {
    expect(isQuorumNotice('Notice: possible quorum — Hobo Day Parade — Sat, Oct 24, 2026')).toBe(true);
    expect(isQuorumNotice('City Council Regular Meeting')).toBe(false);
  });
  it('titleIncludes: one title contained in the other, ignoring filler words and plurals', () => {
    expect(titleIncludes('The Yule Market', 'Museum Shop Yule Market Opens')).toBe(true);
    expect(titleIncludes('The Yule Market Opening Day', 'Museum Shop Yule Market Opens')).toBe(true); // opens = opening
    expect(titleIncludes('The Yule Market', 'The Yule Market Opening Day')).toBe(true);
    expect(titleIncludes('Pancake Breakfast', 'Family Breakfast')).toBe(false);
    expect(titleIncludes('', 'Anything')).toBe(false);
  });
});

describe('groupWeekItems: ordering and the top-event group', () => {
  const all = week({
    1: [item({ vertical: 'city_hall', title: 'City Council Regular Meeting', startsAt: null })],
    2: [item({ title: 'Fall Choir Concert', vertical: 'sdsu', startsAt: '2026-10-22T00:30:00Z' })],
    4: [
      item({ vertical: 'sports', title: 'volleyball vs USD', startsAt: '2026-10-24T00:00:00Z', venue: 'First Bank & Trust Arena' }),
      item({ title: '114th Hobo Day', startsAt: '2026-10-24T05:00:00Z' }),
    ],
  });
  it('puts top events first in "Big this week", then themes in order, omitting empty ones', () => {
    const groups = groupWeekItems(all, all, TZ, ['Hobo Day']);
    expect(groups.map((g) => g.id)).toEqual(['big', 'city', 'music', 'sports']);
    expect(groups[0].rows[0]).toMatchObject({ when: 'Fri all day', title: '114th Hobo Day' });
    expect(groups.find((g) => g.id === 'sports')!.rows[0]).toMatchObject({ when: 'Fri 7pm', title: 'Volleyball vs South Dakota', venue: 'First Bank & Trust Arena' });
  });
  it('without top patterns the same event stays in its normal theme', () => {
    expect(groupWeekItems(all, all, TZ).map((g) => g.id)).toEqual(['city', 'music', 'sports', 'community']);
  });
  it('leaves out days that were not passed (past days of the current week)', () => {
    expect(groupWeekItems(all.slice(3), all, TZ).map((g) => g.id)).toEqual(['sports', 'community']);
  });
});

describe('groupWeekItems: quorum notices', () => {
  it('drops "Notice: possible quorum" rows', () => {
    const all = week({
      5: [
        item({ vertical: 'city_hall', title: 'Notice: possible quorum — Hobo Day Parade — Sat, Oct 24, 2026', startsAt: null }),
        item({ vertical: 'city_hall', title: 'City Council Regular Meeting', startsAt: null }),
      ],
    });
    const rows = groupWeekItems(all, all, TZ).flatMap((g) => g.rows);
    expect(rows.map((r) => r.title)).toEqual(['City Council Regular Meeting']);
  });
});

describe('groupWeekItems: recurring items across days', () => {
  const shanty = (startsAt: string) => item({ vertical: 'sdsu', title: 'Bum Over - Winning Shanty Display', startsAt, venue: 'University Student Union' });
  it('is one row with a day interval when it repeats at the same time on consecutive days', () => {
    // Fri, Sat, Sun 8am Chicago (13:00Z)
    const all = week({
      4: [shanty('2026-10-23T13:00:00Z')], 5: [shanty('2026-10-24T13:00:00Z')], 6: [shanty('2026-10-25T13:00:00Z')],
    });
    const rows = groupWeekItems(all, all, TZ).flatMap((g) => g.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ when: 'Fri–Sun 8am', title: 'Bum Over - Winning Shanty Display', venue: 'University Student Union' });
  });
  it('stays separate rows when the time of day differs', () => {
    const all = week({ 4: [shanty('2026-10-23T13:00:00Z')], 5: [shanty('2026-10-24T20:00:00Z')] });
    expect(groupWeekItems(all, all, TZ).flatMap((g) => g.rows).map((r) => r.when)).toEqual(['Fri 8am', 'Sat 3pm']);
  });
  it('lists non-consecutive days with commas', () => {
    const all = week({ 0: [shanty('2026-10-19T13:00:00Z')], 2: [shanty('2026-10-21T13:00:00Z')] });
    expect(groupWeekItems(all, all, TZ).flatMap((g) => g.rows)[0].when).toBe('Mon, Wed 8am');
  });
});

describe('groupWeekItems: same place and day, one title inside the other', () => {
  const yule = [
    item({ title: 'Museum Shop Yule Market Opens', venue: 'South Dakota Art Museum, 1036 Medary Ave', startsAt: '2026-10-24T15:00:00Z', href: '/s/yule-opens/' }),
    item({ title: 'The Yule Market', startsAt: '2026-10-24T15:00:00Z', href: '/s/yule-market/' }),
  ];
  it('merges them into one row that keeps the venue', () => {
    const all = week({ 5: yule });
    const rows = groupWeekItems(all, all, TZ).flatMap((g) => g.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ when: 'Sat 10am', venue: 'South Dakota Art Museum' });
  });
  it('does not merge different times or different known venues', () => {
    const later = [{ ...yule[1], startsAt: '2026-10-24T18:00:00Z' }];
    const a = week({ 5: [yule[0], ...later] });
    expect(groupWeekItems(a, a, TZ).flatMap((g) => g.rows)).toHaveLength(2);
    const b = week({ 5: [yule[0], { ...yule[1], venue: 'Somewhere Else' }] });
    expect(groupWeekItems(b, b, TZ).flatMap((g) => g.rows)).toHaveLength(2);
  });
});

describe('groupWeekItems: sports rows', () => {
  const all = week({
    5: [
      item({ vertical: 'sports', title: 'football vs Murray State', href: '/jackrabbits/', startsAt: '2026-10-24T19:00:00Z' }),
      item({ title: 'SDSU Football vs Murray State', href: '/s/football-murray/', startsAt: '2026-10-24T19:00:00Z', venue: 'Dana J. Dykhouse Stadium, 1396 Stadium Rd' }),
    ],
  });
  it('are normalized and the same game from two sources is one row (own page and venue kept)', () => {
    const sports = groupWeekItems(all, all, TZ).find((g) => g.id === 'sports')!;
    expect(sports.rows).toHaveLength(1);
    expect(sports.rows[0]).toMatchObject({ when: 'Sat 2pm', title: 'Football vs Murray State', href: '/s/football-murray/', venue: 'Dana J. Dykhouse Stadium' });
  });
});
