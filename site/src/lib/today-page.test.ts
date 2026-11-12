import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { todayDate, todayIndexVerdict, weatherToday, hoursToday, type TodayHoursPlace } from './today-page';
import type { PlaceHoursRow, WeatherPeriod } from './db';

const TZ = 'America/Denver';
// Broomfield, Thursday 2026-11-12, 4:00 PM MST (the 23:00 UTC build).
const NOW = new Date('2026-11-12T23:00:00Z');

// weather_snapshots id 2975 (broomfield_co, observed_for 2026-11-12), first three periods verbatim.
const PERIODS: WeatherPeriod[] = [
  { name: 'This Afternoon', temp: 67, unit: 'F', wind: '6 mph', short: 'Sunny', start: '2026-11-12T14:00:00-07:00', is_daytime: true },
  { name: 'Tonight', temp: 39, unit: 'F', wind: '5 mph', short: 'Mostly Clear', start: '2026-11-12T18:00:00-07:00', is_daytime: false },
  { name: 'Friday', temp: 62, unit: 'F', wind: '5 mph', short: 'Partly Sunny', start: '2026-11-13T06:00:00-07:00', is_daytime: true },
];

const week = (rows: [number, string | null, string | null][]): PlaceHoursRow[] =>
  rows.map(([day_of_week, opens, closes]) => ({ day_of_week, opens, closes, valid_from: null, valid_to: null }));
// place_hours rows as stored for broomfield_co (2026-11-12); verified_date from places.
const RECYCLING: TodayHoursPlace = {
  slug: 'broomfield-recycling-center', name: 'Broomfield Recycling Center', verified_date: '2026-11-11', exceptions: [],
  hours: week([0, 1, 2, 3, 4, 5, 6].map((d) => [d, '00:00:00', '23:59:00'])),
};
const LIBRARY: TodayHoursPlace = {
  slug: 'library', name: 'Mamie Doud Eisenhower Public Library', verified_date: '2026-09-13', exceptions: [],
  hours: week([[0, '13:00:00', '17:00:00'], [1, '09:00:00', '21:00:00'], [2, '09:00:00', '21:00:00'], [3, '09:00:00', '21:00:00'],
    [4, '09:00:00', '21:00:00'], [5, '09:00:00', '17:00:00'], [6, '09:00:00', '17:00:00']]),
};
// The one changed field: verified_date is 2026-09-13 in places; moved inside 45 days so only the missing Thursday row decides.
const DEPOT: TodayHoursPlace = {
  slug: 'broomfield-depot-museum', name: 'Broomfield Depot Museum', verified_date: '2026-11-11', exceptions: [],
  hours: week([[6, '11:00:00', '16:00:00']]),
};

describe('todayDate', () => {
  it('is the town calendar date, written out', () => {
    expect(todayDate(NOW, TZ)).toEqual({ iso: '2026-11-12', label: 'Thursday, November 12' });
    // 6:30 AM UTC Friday is still Thursday evening in Broomfield
    expect(todayDate(new Date('2026-11-13T06:30:00Z'), TZ).iso).toBe('2026-11-12');
  });
});

describe('weatherToday', () => {
  it("lists only the periods that start on the town's today, in the source's words", () => {
    expect(weatherToday(PERIODS, NOW, TZ)).toEqual(['This Afternoon: Sunny, high 67°F', 'Tonight: Mostly Clear, low 39°F']);
  });
  it('says nothing from a snapshot that has no period for today', () => {
    expect(weatherToday(PERIODS.slice(2), NOW, TZ)).toEqual([]);
  });
});

describe('hoursToday', () => {
  it('shows round-the-clock places as such and leaves out a weekday nobody recorded', () => {
    expect(hoursToday([RECYCLING, DEPOT], NOW, TZ, 45, false)).toEqual([
      { slug: 'broomfield-recycling-center', name: 'Broomfield Recycling Center', text: 'Open 24 hours' },
    ]);
  });
  it('leaves out hours checked longer ago than the town allows (library: 2026-09-13, 60 days)', () => {
    expect(hoursToday([LIBRARY], NOW, TZ, 45, false)).toEqual([]);
    // the one changed field: verified_date
    expect(hoursToday([{ ...LIBRARY, verified_date: '2026-11-11' }], NOW, TZ, 45, false))
      .toEqual([{ slug: 'library', name: 'Mamie Doud Eisenhower Public Library', text: '9:00 AM–9:00 PM' }]);
  });
  it('reads verified_date as the Neon driver hands it over (a Date at local midnight), not only as a string', () => {
    // places.verified_date of the library, as the build received it on 2026-11-12 (Europe/Stockholm machine): 60 days old, so left out
    const asDriver = new Date(2026, 8, 13);
    expect(hoursToday([{ ...LIBRARY, verified_date: asDriver }], NOW, TZ, 45, false)).toEqual([]);
  });
  it('a sourced closure on the date says closed; a public holiday shows nothing', () => {
    // the one changed field: an exception row (none is stored for Broomfield today)
    const closed = { ...RECYCLING, exceptions: [{ date: '2026-11-12', opens: null, closes: null, reason: null, source_url: null, last_verified_at: null }] };
    expect(hoursToday([closed], NOW, TZ, 45, false)[0].text).toBe('Closed today');
    expect(hoursToday([RECYCLING], NOW, TZ, 45, true)).toEqual([]);
  });
});

describe('todayIndexVerdict (owner 2026-11-12)', () => {
  const cfg = { minBlocks: 3, requireOpenTonightData: true };
  it('stays noindex before indexFrom even with data and enough blocks (Broomfield: 2026-11-19)', () => {
    const all = { weather: true, hours: true, openTonight: true };
    expect(todayIndexVerdict({ ...cfg, indexFrom: '2026-11-19' }, all, true, '2026-11-18')).toMatchObject({ indexable: false, reason: 'before-index-date' });
    expect(todayIndexVerdict({ ...cfg, indexFrom: '2026-11-19' }, all, true, '2026-11-19')).toMatchObject({ indexable: true });
  });
  it('stays noindex without Open tonight data, however many blocks are filled', () => {
    expect(todayIndexVerdict(cfg, { weather: true, hours: true, meetings: true, events: true }, false, '2026-11-12'))
      .toMatchObject({ indexable: false, reason: 'no-open-tonight-data' });
  });
  it('with Open tonight data: three filled blocks index, two do not; Open tonight counts as one', () => {
    expect(todayIndexVerdict(cfg, { weather: true, hours: true }, true, '2026-11-12')).toMatchObject({ indexable: false, reason: 'too-few-blocks' });
    expect(todayIndexVerdict(cfg, { weather: true, hours: true, openTonight: true }, true, '2026-11-12'))
      .toEqual({ indexable: true, filled: ['weather', 'hours', 'openTonight'], reason: 'ok' });
  });
});

describe('QA build.today-page mirror', () => {
  it('scripts/verify_today_page.mjs checks exactly the towns with SiteConfig.todayPage', () => {
    const src = readFileSync(new URL('../../../scripts/verify_today_page.mjs', import.meta.url), 'utf8');
    const mirror = JSON.parse(src.match(/TODAY_PAGE_TOWNS = (\[[^\]]*\])/)![1].replace(/'/g, '"'));
    expect(mirror).toEqual(ALL_CONFIGS.filter((c) => c.todayPage).map((c) => c.townId));
  });
});
