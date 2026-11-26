import { describe, expect, it } from 'vitest';
import {
  ALL_WEEK_DAYS, formatDays, formatWhen, groupWeekItems, weekDayBlocks, isQuorumNotice, isSportItem, normalizeSportTitle, shortVenue, themeOf, titleIncludes,
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

describe('isSportItem / themeOf: SDSU feed fixtures land in Sports with a readable title (2026-10-23)', () => {
  it('recognises sport-code fixtures and athletics-category fixtures, not other campus events', () => {
    expect(isSportItem({ vertical: 'sdsu', title: 'VB vs USD' })).toBe(true);
    expect(isSportItem({ vertical: 'sdsu', title: 'MBB vs  Valpo' })).toBe(true);
    expect(isSportItem({ vertical: 'sdsu', title: 'Soccer vs Idaho' })).toBe(true);
    expect(isSportItem({ vertical: 'sdsu', title: 'NAU vs Bradley', categories: ['Athletics'] })).toBe(true);
    expect(isSportItem({ vertical: 'sdsu', title: 'Jazz at the Union' })).toBe(false);
    expect(isSportItem({ vertical: 'sdsu', title: 'Bum Over - Winning Displays' })).toBe(false);
    expect(themeOf({ vertical: 'sdsu', title: 'VB vs USD' })).toBe('sports');
  });
});

describe('rows carry start/end so the browser can drop passed ones (university digest, 2026-10-24)', () => {
  it('a timed row starts at its own instant; a merged multi-day row at its LAST day', () => {
    const fri = item({ title: 'Hobo Day Expo', startsAt: '2026-10-24T13:00:00Z', endsAt: '2026-10-24T15:00:00Z' });
    const sat = item({ title: 'Hobo Day Expo', startsAt: '2026-10-25T13:00:00Z', endsAt: '2026-10-25T15:00:00Z' });
    const all = week({ 4: [fri], 5: [sat] });
    const groups = groupWeekItems(all, all, TZ);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].start).toBe('2026-10-25T13:00:00Z');
    expect(rows[0].end).toBe('2026-10-25T15:00:00Z');
  });

  it('a date-only item (a meeting) starts at local midnight of its day, so it is gone the day after', () => {
    const council = item({ vertical: 'city_hall', title: 'City Council', startsAt: null });
    const all = week({ 0: [council] });  // Mon 19 Oct 2026, Chicago (CDT, UTC-5)
    const rows = groupWeekItems(all, all, TZ).flatMap((g) => g.rows);
    expect(rows[0].start).toBe('2026-10-19T05:00:00.000Z');
    expect(rows[0].end).toBeNull();
  });
});

describe('weekDayBlocks (design lift rollout a, owner 2026-11-26 (7))', () => {
  // Real rows: Glasgow /this-week/2026-w48/ as built 2026-11-26 (battery build): title, href, venue and time ordagrant.
  const LON = 'Europe/London';
  const GL = 'https://www.glasgowlife.org.uk/event';
  const gday = (items: DayItem[], i: number): DayBucket => ({ date: { y: 2026, m: 11, d: 23 + i }, weekdayName: NAMES[i], leadVertical: 'events', items });
  const meeting: DayItem = { vertical: 'city_hall', title: 'Contracts and Property Committee — Thu 26 Nov 2026', href: '/s/meeting-2026-11-26-15127/', external: false, detail: '', startsAt: null };
  const softPlay: DayItem = { vertical: 'events', title: 'Soft Play Music Mornings', href: `${GL}/1/soft-play-music-mornings`, external: true, detail: '', startsAt: '2026-11-26T09:30:00Z', venue: 'Kelvin Hall' };
  const knitting: DayItem = { vertical: 'events', title: 'Honey Bees Knitting group', href: `${GL}/1/honey-bees-knitting-group`, external: true, detail: '', startsAt: '2026-11-26T13:30:00Z', venue: 'Royston Library' };
  const artClub: DayItem = { vertical: 'events', title: 'Saturday Art Club', href: `${GL}/28/saturday-art-club`, external: true, detail: '', startsAt: '2026-11-28T10:30:00Z', venue: 'Gallery of Modern Art' };
  const label = (ymd: string) => `L ${ymd}`;

  it('one group per day with rows, keyed by the town day; the meeting (no time) first, then by time', () => {
    const days = NAMES.map((_, i) => gday(i === 3 ? [softPlay, knitting, meeting] : i === 5 ? [artClub] : [], i));
    const b = weekDayBlocks(days, days, LON, label, 'Glasgow');
    expect(b.allWeek).toEqual([]);
    expect(b.days.map((d) => [d.key, d.label])).toEqual([['2026-11-26', 'L 2026-11-26'], ['2026-11-28', 'L 2026-11-28']]);
    expect(b.days[0].rows.map((r) => [r.time, r.title, r.category])).toEqual([
      ['', 'Contracts and Property Committee — Thu 26 Nov 2026', 'civic'],
      ['9:30am', 'Soft Play Music Mornings', 'music'],
      ['1:30pm', 'Honey Bees Knitting group', null],
    ]);
    expect(b.days[0].rows[1]).toMatchObject({ href: `${GL}/1/soft-play-music-mornings`, rel: 'noopener', place: ['Kelvin Hall'], day: '2026-11-26' });
  });

  it(`on ${ALL_WEEK_DAYS}+ days: one card in "All week", gone from the days (Soft Play, changed field: also on Fri 27 and Sat 28)`, () => {
    const fri = { ...softPlay, startsAt: '2026-11-27T09:30:00Z' };
    const sat = { ...softPlay, startsAt: '2026-11-28T09:30:00Z' };
    const days = NAMES.map((_, i) => gday(i === 3 ? [softPlay, knitting] : i === 4 ? [fri] : i === 5 ? [sat, artClub] : [], i));
    const b = weekDayBlocks(days, days, LON, label, 'Glasgow');
    expect(b.allWeek.map((r) => [r.when, r.title, r.venue])).toEqual([['Thu–Sat 9:30am', 'Soft Play Music Mornings', 'Kelvin Hall']]);
    expect(b.days.flatMap((d) => d.rows.map((r) => r.title))).toEqual(['Honey Bees Knitting group', 'Saturday Art Club']);
  });

  it('on two days: stays under each day, with the days as an extra (so it is not the featured card)', () => {
    const sat = { ...softPlay, startsAt: '2026-11-28T09:30:00Z' };
    const days = NAMES.map((_, i) => gday(i === 3 ? [softPlay] : i === 5 ? [sat] : [], i));
    const b = weekDayBlocks(days, days, LON, label, 'Glasgow');
    expect(b.days.map((d) => d.rows[0].extra)).toEqual([['Thu, Sat'], ['Thu, Sat']]);
  });
});

describe('weekDayBlocks: nearby apart (owner 2026-11-26 (9))', () => {
  // Real rows: Broomfield /whats-on/ 2026-11-26, Joseph and the Amazing Technicolor Dreamcoat at Arvada Center (Fri-Sun) and
  // A Christmas Carol at the Denver Center (JSON-LD, ordagrant); `nearby` as the week builder sets it for a Ticketmaster venue.
  const DEN = 'America/Denver';
  const bday = (items: DayItem[], i: number): DayBucket => ({ date: { y: 2026, m: 11, d: 23 + i }, weekdayName: NAMES[i], leadVertical: 'events', items });
  const joseph = (iso: string): DayItem => ({ vertical: 'events', title: 'Joseph and the Amazing Technicolor Dreamcoat', href: 'https://www.ticketmaster.com/event/joseph', external: true, detail: '', startsAt: iso, venue: 'Arvada Center · Arvada', nearby: { city: 'Arvada', ticket: true } });
  const carol: DayItem = { vertical: 'events', title: 'A Christmas Carol', href: 'https://www.ticketmaster.com/event/Z7r9jZ1AAZyaJ', external: true, detail: '', startsAt: '2026-11-28T02:00:00Z', venue: 'Denver Center for the Performing Arts · Denver', nearby: { city: 'Denver', ticket: true } };
  it('a nearby row is in the day\'s `nearby`, never in its rows; a nearby run on 3 days is not in the town\'s "All week"', () => {
    const days = NAMES.map((_, i) => bday(i === 4 ? [joseph('2026-11-27T20:00:00Z'), carol] : i === 5 ? [joseph('2026-11-28T20:00:00Z')] : i === 6 ? [joseph('2026-11-29T20:00:00Z')] : [], i));
    const b = weekDayBlocks(days, days, DEN, (k) => k, 'Broomfield');
    expect(b.allWeek).toEqual([]);
    expect(b.days.map((d) => [d.key, d.rows.length, d.nearby?.map((r) => r.title)])).toEqual([
      ['2026-11-27', 0, ['Joseph and the Amazing Technicolor Dreamcoat', 'A Christmas Carol']], // 1pm before 7pm
      ['2026-11-28', 0, ['Joseph and the Amazing Technicolor Dreamcoat']],
      ['2026-11-29', 0, ['Joseph and the Amazing Technicolor Dreamcoat']],
    ]);
  });
});
